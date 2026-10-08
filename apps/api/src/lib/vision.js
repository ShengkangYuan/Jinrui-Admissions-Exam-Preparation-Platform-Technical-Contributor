// 视觉大模型客户端(OpenAI 兼容的多模态 chat completions)。
// 用于 PDF 批量导入:把栅格化后的试卷页面图片交给视觉模型,由其读取渲染后的数学公式,
// 输出结构化的选择题 JSON(题干/选项/答案/解析都带规范 LaTeX)。
//
// 环境变量:
//   VISION_API_KEY  (必填) 视觉模型 API Key
//   VISION_BASE_URL (可选) 默认通义千问 DashScope 兼容端点 https://dashscope.aliyuncs.com/compatible-mode/v1
//   VISION_MODEL    (可选) 默认 qwen2.5-vl-72b-instruct
//
// 注:deepseek-chat 是纯文本模型,看不了图;PDF 导入必须配一个视觉模型。
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen2.5-vl-72b-instruct";

export function isVisionConfigured() {
  return !!process.env.VISION_API_KEY;
}

function baseUrl() {
  return (process.env.VISION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
function model() {
  return process.env.VISION_MODEL || DEFAULT_MODEL;
}

const SYSTEM_PROMPT = `你是一个考试题库录入助手。用户会给你一份数学入学考试试卷(一页或多页图片,已按页面顺序给出),可能还附上每页提取的纯文本(仅供参考,数学公式以图片渲染为准)。

请从中提取每一道选择题,严格按以下 JSON 数组格式输出。不要输出任何额外说明、不要使用 markdown 代码围栏,只输出可直接解析的 JSON 数组:

[
  {
    "subject": "TMUA 或 ESAT 或 学科名",
    "qno": "题号(整数,如 21;若题目本身无显式题号可填空字符串)",
    "paper": "试卷名/场次(可选,没有则空字符串)",
    "topic": "知识点,优先用英文 A Level 术语(如 Differentiation / Trigonometry / Sequences and Series / Integration / Algebra and Functions);也可用中文关键词",
    "difficulty": 1到5的整数(可选,默认3),
    "type": "SINGLE_CHOICE 或 MULTIPLE_CHOICE 或 TRUE_FALSE",
    "stem": "题干全文。所有数学用 LaTeX 书写:行内公式用 $...$,独立成行的公式用 $$...$$。务必让每个定界符成对闭合。",
    "options": ["选项正文","选项正文","选项正文","选项正文"(至少2个,最多8个)],
    "answer": "正确答案。可写选项字母(A-H),也可写与选项文本完全一致的文本;多选题写字母如 \\"A, C\\"",
    "solution": "解题步骤/解析(可选,没有则空字符串)。数学同样用 LaTeX。",
    "source": "PDF 导入"
  }
]

重要规则:
- 数学符号必须写成规范 LaTeX:例如 \\log 不要写成 log,\\sin \\cos \\tan \\lim \\frac \\sqrt \\leq \\geq \\times \\cdot \\neq 等;上标用 ^,下标用 _。
- 每个公式定界符必须成对:开 $ 必有闭 $,开 $$ 必有闭 $$。绝不要在公式中间出现孤立的 $。
- **公式定界符选择(关键,防止显示错乱)**:
  - **短公式 / 简单等式 / 单变量赋值 / 短不等式 / 短函数定义**  → 一律用**行内** $...$ 行内(例: $x_1 = 7$ 、 $a+b=c$ 、 $f(x) = 2x+1$ 、 $p < x < q$ );
  - **多行 / 分式 / 积分 / 求和 / 极限 / 矩阵 / 复杂表达式** 才用独立 $$...$$ 块级(例: $$\int_0^1 f(x)\,dx$$);像 $x_1 = 7$ 、 $x_{n+1} = \frac{...}{...}$ 属于「短公式」,**禁止用 $$...$$**;
  - **严禁**出现 $$x_1 = 7$x_{n+1} = ...$$ 这类「块级与行内混用」或「半边定界符」——开 $$ 必须等距配对闭合 $$,开 $ 必须等距配对闭合 $;**任何公式要么完整 $...$ 要么完整 $$...$$**;prompt 内的规则示例**禁止使用反引号包裹**——反引号会提前闭合模板字符串导致 api 启动失败,本规则之前已踩坑两次(V2.3.15 修复 + 此次 V2.3.18 又踩)。
  - **每个公式必须独占独立一行**:严禁把两个公式挤在同一行(例 $$ 公式A $$ 公式B $$ -- 中间公式 B 没有定界符会导致 tokenize 崩溃);输出多公式题干时每个公式前必须换行,互相分开;每行最多一个公式+一句话文本。
  - **罗马数字序号识别(关键)**:题干中常出现的 I、II、III、IV、V 等是**序号**(对应 1、2、3、4、5),不是变量/不是数学符号。当 I/II/III 后紧跟公式(如 I y=x^3-3x^2+9x-27)时,它们是**列表序号**,必须这样输出:每个序号独立一行(换行分隔),序号与公式间用空格,例如:
    I $y = x^3 - 3x^2 + 9x - 27$
    II $y = x^3 - 9x^2 + 27x - 3$
    III $y = 27x^3 - 9x^2 + x - 3$
  **严禁**把多个 I/II/III 序号项挤在同一行(如 I ... II ... III ... 连写);每项必须换行。
- 题干与选项拆开,不要把选项混进题干;保留选项原始字母顺序 A、B、C、D。
- **options 数组里只放选项正文,绝对不要包含选项标号前缀(如 "A. "、"A) "、"A " 这类标准标号)**。如果选项正文本身以单个字母 A/B/C/D 开头(例如题干中有图 A、图 B、图 C、图 D,选项写成 "A and D, but not B or C"),这个字母是正文内容,必须保留,不要删除。选项的 A./B./C. 标签由系统自动添加。
- **横向/紧凑排列的选项(常见于 SMC / Senior Mathematical Challenge 等短选项卷)**:若页面上 A/B/C/D/E 五个选项沿水平方向排成一行或按列分布,不要只输出 "A","B","C","D","E" 字母。必须读取每个字母**下方/右侧对应的具体内容**作为选项正文;若某选项内容确实为空,也至少写出该位置可见的数学表达式或文字(哪怕很短,如 "$2$"、"$x^2$"),严禁整组选项都只返回字母。
- **一页图片可能包含多道题,必须逐题输出独立对象,严禁把多道题的选项合并进同一个对象**:正常情况下每道题 2–8 个选项;若你提取的某题选项明显多于 8 个,几乎可以肯定是把多道题的选项拼在了一起,必须拆分成多道题、逐题单独输出。
- **不要漏题**:一页若有多道题,请确保把每一道都输出(漏题会导致导入题数少于原卷,这是已知高频问题)。宁可保留题号占位,也不要跳过任何一道。
- **单位与普通文本不要用 $...$ 包裹**:mol、g、cm、cm³、min、s、V、J、K 等单位,以及 "2.0 mol"、"1 × 10⁶ g" 这类数字+单位,直接写成普通文本;只有真正的数学表达式(分数、根号、等式、指数、下标、化学式如 $\\mathrm{C_3H_7OH}$)才用 $...$。这样题干字体才稳定统一。
- 不要使用 \\text{}、\\emph{}、\\textit{}、\\textbf{}、\\mathit{} 等字体控制命令;化学式统一用 $\\mathrm{...}$ 形式。
- 答案(answer)必须从试卷图片中明确给出的答案 key、答案页或解析中读取,不要自行计算;如果图片中没有任何答案/解析信息,answer 填空字符串,不要猜。
- **答案页识别(关键)**:许多试卷的最后几页会单独列出答案表,常见两种格式——
  1. **表格形式**(如 NSAA / A-Level 附录答案):每行形如 Q21 A、22. B、Question 23 C,或带学科列 Q21 A PHYS。**忽略学科列(若有),只取字母列**作为该题答案;
  2. **逐题列答案**(部分试卷直接接在题目页下方):按题号取字母。
  请逐行扫描答案页/表格,把每个题号对应的字母填到对应题的 answer 字段。**题号 Q21 应对应第 21 题**(不是 PDF 文件序号)。多选题写字母如 "A, C"。**注意:题目提取时务必输出 qno(题号),答案匹配按 qno 而非顺序进行,因此 qno 必须与答案表题号一致,切勿漏写或错位。**
- 只提取选择题;非选择题(简答/证明/填空)若无法用选项表示则跳过。
- 如果某页是说明/封面/空白,不要生成题目。
- 确保输出的 JSON 可被直接解析(不要省略逗号或引号)。`;

// 从模型输出里尽量稳健地取出 JSON 数组
export function parseJsonArray(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.questions)) return v.questions;
    if (v && Array.isArray(v.data)) return v.data;
  } catch {
    /* ignore */
  }
  return [];
}

// 单批页面的视觉提取(内部复用,便于逐批重试)
async function callChunkVision(chunk, idx) {
  const content = [
    {
      type: "text",
      text: "请从以下页面的试卷图片中提取所有选择题,严格按系统提示要求的 JSON 数组格式输出。",
    },
  ];
  let textHint = "";
  chunk.forEach((p, ci) => {
    content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${p.image}` } });
    if (p.text) textHint += `\n[第 ${ci + 1} 页纯文本参考]\n${p.text}\n`;
  });
  if (textHint) {
    content.push({
      type: "text",
      text: "各页纯文本(公式可能不准,仅用于辅助判断题号与结构,数学以图片为准):" + textHint,
    });
  }
  const resp = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VISION_API_KEY}`,
    },
    body: JSON.stringify({
      model: model(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content || "";
  return parseJsonArray(text);
}

export async function extractQuestionsFromPdfPages(pages, { maxPagesPerCall } = {}) {
  // 每次调用的页数:页太多会让模型丢题/截断。默认 4 页,可用 VISION_MAX_PAGES 调整。
  const perCall = Math.max(1, Math.min(16, Number(maxPagesPerCall) || Number(process.env.VISION_MAX_PAGES) || 4));
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const chunks = [];
  for (let i = 0; i < pages.length; i += perCall) {
    chunks.push(pages.slice(i, i + perCall));
  }
  const all = [];
  const RETRIES = 3; // 每批最多重试次数:视觉模型偶发漏题/截断时重试
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    let batch = [];
    let attempt = 0;
    // 重试策略:提取为空 / 请求异常 → 重试;单批多页时若只识别出极少题也可重试一次
    for (; attempt < RETRIES; attempt++) {
      try {
        batch = await callChunkVision(chunk, ci);
        // 空结果视为模型没读到,重试;非空且数量合理则接受
        if (batch.length > 0) break;
        if (attempt === 0) console.warn(`[vision] chunk ${ci + 1} 提取为空,重试(${attempt + 1}/${RETRIES})`);
      } catch (e) {
        // 请求异常:瞬时失败,等待后重试
        if (attempt < RETRIES - 1) {
          console.warn(`[vision] chunk ${ci + 1} 请求失败:${e.message},重试(${attempt + 1}/${RETRIES})`);
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        } else {
          throw e;
        }
      }
    }
    all.push(...batch);
  }
  return all;
}

// 从模型输出里尽量稳健地取出单个 JSON 对象
export function parseJsonObject(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 单题图片识别:一张图一道选择题 → 结构化 JSON
const SINGLE_QUESTION_PROMPT = `你是一个考试题库录入助手。用户会给一张包含一道选择题的图片(题干+选项,可能还带答案标注)。
请识别这道题,严格按以下 JSON 对象格式输出(不要 markdown 代码围栏,不要输出任何额外说明,只输出可直接解析的 JSON 对象):
{
  "subject": "数学 或 物理 或 化学 或 生物,或 TMUA/ESAT/NSAA 等题源名(不确定时填空字符串)",
  "topic": "知识点(英文 A Level 术语优先,如 Differentiation / Trigonometry / Sequences and Series / Mechanics)",
  "difficulty": 1到5的整数(可选,默认3),
  "type": "SINGLE_CHOICE 或 MULTIPLE_CHOICE 或 TRUE_FALSE",
  "stem": "题干全文,公式用规范 LaTeX 行内 $...$ 包裹,每个定界符必须成对闭合",
  "options": ["选项正文","选项正文","选项正文","选项正文"(2到8个,不带字母前缀)],
  "answer": "正确答案:若图片给出答案则写对应选项字母(A-H)或与选项文本完全一致的文本;若图片没有答案信息则填空字符串,不要猜",
  "solution": "解析(可选,没有则空字符串)"
}
重要规则:
- 数学符号必须用规范 LaTeX(如 \\log \\sin \\cos \\tan \\frac \\sqrt \\leq \\geq \\times \\cdot \\neq);行内公式用 $...$,独立公式用 $$...$$。
- options 数组里只放选项正文,**绝对不要包含 A./B./C. 之类的字母前缀**,选项的字母标签由系统自动添加。
- 单位(mol、g、cm、cm³、s、V、J、K 等)与"2.0 mol"这类数字+单位直接写普通文本,不要用 $...$ 包裹;只有真正的数学表达式才用 $...$。
- 答案(answer)必须来自图片上明确给出的答案 key 或解析;若图片没有答案信息,answer 填空字符串,严禁自行计算或猜测。
- 图片中应只有一道题;若明显包含多道题,只取第一道完整题输出。`;

export async function extractQuestionFromImage(imageDataUrl) {
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const content = [
    { type: "text", text: "请识别下面这张图片中的这道选择题,严格按系统提示要求的 JSON 对象格式输出。" },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
  const resp = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VISION_API_KEY}`,
    },
    body: JSON.stringify({
      model: model(),
      messages: [
        { role: "system", content: SINGLE_QUESTION_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content || "";
  const obj = parseJsonObject(text);
  if (!obj || typeof obj !== "object") throw new Error("视觉模型未返回有效 JSON");
  return obj;
}

// ——— 雅思/语言阅读篇章提取(一篇文章 + 绑定它的若干题目,作为一个整体单元) ———
// 与学科题库的选择题提取分开:阅读必须把「文章正文」完整取出,题目挂在文章下
const PASSAGE_PROMPT = `你是一个雅思(IELTS)阅读题库录入助手。用户会给你一份阅读试卷的图片(一页或多页,已按顺序给出),可能附带每页的纯文本。

请把试卷拆成若干个「阅读篇章」单元。一个篇章 = 一篇完整文章 + 属于这篇文章的全部题目。严格按以下 JSON 数组格式输出,不要输出任何额外说明、不要使用 markdown 代码围栏,只输出可直接解析的 JSON 数组:

[
  {
    "title": "篇章标题,如 Passage 1: The Story of Tea(没有标题时用文章首句概括)",
    "content": "文章正文全文。保留自然段落,段落之间用两个换行分隔。若原文段落带 A/B/C 段标,请在段首保留该字母加一个空格。",
    "questions": [
      {
        "qType": "TRUE_FALSE_NG 或 FILL_BLANK 或 SINGLE_CHOICE 或 MULTIPLE_CHOICE 或 MATCHING 或 HEADING",
        "stem": "题干全文(含题号后的完整问题描述;填空题保留下划线或括号占位)",
        "options": ["选项正文(仅选择/配对/标题题需要,至少2个)"],
        "answer": "正确答案",
        "solution": "解析或答案出处(没有则空字符串)"
      }
    ]
  }
]

重要规则:
- content 必须是**文章正文本身**,绝对不要把题目、题目说明(Questions 1-13 ...)、答案表混进正文。
- questions 里每道题都要绑定到它所属的那一篇文章;不同文章的题目不要混在一起。
- 题型判断:
  - 判断题(TRUE / FALSE / NOT GIVEN 或 YES / NO / NOT GIVEN)→ qType 用 TRUE_FALSE_NG,options 写 ["TRUE","FALSE","NOT GIVEN"](或 YES/NO/NOT GIVEN),answer 写其中之一;
  - 摘要填空 / 句子填空 / 表格填空 → FILL_BLANK,不要 options,answer 写标准答案(多个可接受答案用竖线分隔,如 analysis|analyses);
  - 四选一等单选 → SINGLE_CHOICE,answer 写选项字母;
  - 多选(选两项及以上)→ MULTIPLE_CHOICE,answer 写字母如 "A, C";
  - 信息/人名/段落匹配 → MATCHING,options 放可选项列表,answer 写字母;
  - 段落小标题配对(List of Headings)→ HEADING,options 放 headings 列表,answer 写罗马数字或字母。
- options 数组里只放选项正文,**不要包含 A. / B. 之类的字母前缀**,字母由系统自动添加。
- answer 必须来自试卷上明确给出的答案 key / 答案页 / 解析;若试卷完全没有答案信息,answer 填空字符串,不要自行推断。
- 只提取阅读部分;封面、说明页、听力/写作部分请跳过。
- 确保输出的 JSON 可被直接解析(不要省略逗号或引号,正文里的换行请写成转义换行)。`;

export async function extractReadingPassagesFromPdfPages(pages, { maxPagesPerCall } = {}) {
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  // 阅读文章需要跨页连续,单批页数比学科题大一些,避免把一篇文章切断
  const perCall = Math.max(1, Math.min(20, Number(maxPagesPerCall) || Number(process.env.VISION_PASSAGE_MAX_PAGES) || 8));
  const chunks = [];
  for (let i = 0; i < pages.length; i += perCall) chunks.push(pages.slice(i, i + perCall));
  const all = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const content = [
      { type: "text", text: "请从以下阅读试卷图片中提取所有「文章 + 其绑定题目」的篇章单元,严格按系统提示的 JSON 数组格式输出。" },
    ];
    let textHint = "";
    chunk.forEach((p, i) => {
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${p.image}` } });
      if (p.text) textHint += `\n[第 ${i + 1} 页纯文本]\n${p.text}\n`;
    });
    if (textHint) {
      content.push({ type: "text", text: "各页纯文本(阅读以文本为主,可优先采用,排版以图片为准):" + textHint });
    }
    let batch = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(`${baseUrl()}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.VISION_API_KEY}`,
          },
          body: JSON.stringify({
            model: model(),
            messages: [
              { role: "system", content: PASSAGE_PROMPT },
              { role: "user", content },
            ],
            temperature: 0.1,
            max_tokens: 16000,
          }),
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
        }
        const json = await resp.json();
        batch = parseJsonArray(json?.choices?.[0]?.message?.content || "");
        if (batch.length > 0) break;
        console.warn(`[vision] 阅读篇章 chunk ${ci + 1} 提取为空,重试(${attempt + 1}/3)`);
      } catch (e) {
        if (attempt < 2) {
          console.warn(`[vision] 阅读篇章 chunk ${ci + 1} 失败:${e.message},重试(${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        } else {
          throw e;
        }
      }
    }
    all.push(...batch);
  }
  return all;
}

// ——— 独立答案文件解析(题目 PDF 与答案 PDF 分开导入时使用) ———
const ANSWER_PROMPT = `你是一个考试答案页识别助手。用户会给你一份考试的答案页/答案表图片(可能是表格形式,如 "Q21 A"、"21. B"、"Question 23 C",有时还带学科列 "Q21 A PHYS")。
请逐行提取每一题的题号与答案,严格按以下 JSON 数组格式输出,不要输出任何额外说明、不要使用 markdown 代码围栏,只输出可直接解析的 JSON 数组:

[
  {"question": 21, "answer": "G"},
  {"question": 22, "answer": "F"}
]

规则:
- question 为题号(忽略 Q/Question 前缀,如 Q21 → 21;带零补位如 021 也归一为 21)。
- answer 为答案字母(A-H)或选项文本;多选题写字母如 "A, C";无法识别的行跳过。
- 若表格带学科列(如 "Q21 A PHYS" / "Q21 A Maths"),忽略学科列,只取字母列。
- 若某页不是答案表或没有可识别答案,输出 []。
- 确保输出的 JSON 可被直接解析。`;

export async function extractAnswersFromPdfPages(pages, { maxPagesPerCall } = {}) {
  const perCall = Math.max(1, Math.min(16, Number(maxPagesPerCall) || Number(process.env.VISION_MAX_PAGES) || 4));
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const chunks = [];
  for (let i = 0; i < pages.length; i += perCall) {
    chunks.push(pages.slice(i, i + perCall));
  }
  const all = [];
  for (const chunk of chunks) {
    const content = [
      { type: "text", text: "请从以下图片中识别答案表/答案页,严格按系统提示要求的 JSON 数组格式输出题号与答案。" },
    ];
    let textHint = "";
    chunk.forEach((p, idx) => {
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${p.image}` } });
      if (p.text) textHint += `\n[第 ${idx + 1} 页纯文本参考]\n${p.text}\n`;
    });
    if (textHint) {
      content.push({ type: "text", text: "各页纯文本(仅供参考,以图片为准):" + textHint });
    }
    const resp = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VISION_API_KEY}`,
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: "system", content: ANSWER_PROMPT },
          { role: "user", content },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
    }
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || "";
    all.push(...parseJsonArray(text));
  }
  return all;
}
