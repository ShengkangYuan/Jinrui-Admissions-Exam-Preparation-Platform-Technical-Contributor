// 通用 OpenAI 兼容 Chat Completions 客户端。
// 通过环境变量配置,不硬编码任何厂商,支持 DeepSeek / 通义千问 / OpenAI / 任意兼容端点:
//   LLM_API_KEY   必填
//   LLM_BASE_URL  默认 https://api.openai.com/v1
//   LLM_MODEL     默认 gpt-4o-mini

export function llmConfigured() {
  return !!process.env.LLM_API_KEY;
}

export function llmInfo() {
  return {
    configured: llmConfigured(),
    base: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  };
}

export async function chatComplete({ system, user, temperature = 0.2, maxTokens = 900, model: modelOverride }) {
  const key = process.env.LLM_API_KEY;
  if (!key) {
    const e = new Error("未配置 LLM_API_KEY,无法生成解析。请在服务端 .env 配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。");
    e.code = "LLM_NOT_CONFIGURED";
    throw e;
  }
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = modelOverride || process.env.LLM_MODEL || "gpt-4o-mini";
  const url = `${base}/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    const e = new Error(`无法连接 LLM 服务 (${base}): ${err.message}`);
    e.code = "LLM_CONNECTION_ERROR";
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const e = new Error(`LLM 调用失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
    e.code = "LLM_HTTP_ERROR";
    throw e;
  }

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    const e = new Error("LLM 返回内容为空");
    e.code = "LLM_EMPTY";
    throw e;
  }
  return content;
}
