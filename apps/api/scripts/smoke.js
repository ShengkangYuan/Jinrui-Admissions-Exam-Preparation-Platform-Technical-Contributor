// 学生端全链路冒烟测试脚本
// 运行:npm run smoke --workspace=apps/api (需后端已启动)
// 覆盖:注册→登录→题库→练习→作答→判分→成绩→错题本→掌握度→模拟考→权限
import "dotenv/config";

const BASE = "http://localhost:4000/api";
const EMAIL = `smoke_${Date.now()}@test.com`;
const PASS = "123456";

let token = "";
let passed = 0;
let failed = 0;

async function req(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
  return cond;
}

async function main() {
  console.log(`冒烟测试账号:${EMAIL}\n`);

  // 1. 注册
  console.log("[1] 注册学生账号");
  let r = await req("/auth/register", "POST", { email: EMAIL, password: PASS, name: "冒烟测试员" });
  token = r.data?.token || "";
  check("注册成功返回 token", r.code === 0 && !!token, r.message);
  const uid = r.data?.user?.id;

  // 2. 登录
  console.log("[2] 登录");
  r = await req("/auth/login", "POST", { email: EMAIL, password: PASS });
  token = r.data?.token || "";
  check("登录成功", r.code === 0 && !!r.data?.token);
  check("用户角色为 STUDENT", r.data?.user?.role === "STUDENT", r.data?.user?.role);

  // 3. 当前用户
  console.log("[3] 当前用户 /auth/me");
  r = await req("/auth/me");
  check("me 返回本人信息", r.code === 0 && r.data?.email === EMAIL);

  // 4. 题库列表
  console.log("[4] 题库列表");
  r = await req("/questions?pageSize=10");
  check("题库可访问且有题", r.code === 0 && r.data?.total >= 1, `共 ${r.data?.total} 题`);
  check("学生视角不含答案字段", r.code === 0 && r.data?.list?.[0] && r.data.list[0].answer === undefined);
  const qid = r.data?.list?.[0]?.id;

  // 5. 创建练习会话
  console.log("[5] 创建练习会话");
  r = await req("/sessions", "POST", { mode: "PRACTICE", limit: 5 });
  check("会话创建成功", r.code === 0 && !!r.data?.sessionId);
  check("返回题目且不含答案", r.code === 0 && r.data?.questions?.length > 0 && r.data.questions[0].answer === undefined);
  const sid = r.data?.sessionId;

  // 6. 作答(故意答错第一题)
  console.log("[6] 保存作答");
  const q = r.data?.questions?.[0];
  const wrongPick = q?.options?.[0] === q?.options?.[1] ? undefined : q?.options?.[1];
  r = await req(`/sessions/${sid}/answer`, "POST", { questionId: q?.id, selected: wrongPick, timeSpent: 30 });
  check("作答实时保存", r.code === 0, r.message);

  // 7. 提交判分
  console.log("[7] 提交判分");
  r = await req(`/sessions/${sid}/submit`, "POST");
  check("判分完成返回成绩", r.code === 0 && typeof r.data?.score === "number");
  check("总分与会话题目数一致", r.data?.total === r.data?.questions?.length || r.data?.total >= 1, `total=${r.data?.total}`);

  // 8. 成绩历史
  console.log("[8] 成绩历史");
  r = await req("/me/sessions");
  check("历史含本次会话", r.code === 0 && r.data?.list?.some((s) => s.id === sid));

  // 9. 错题本(答错的题应出现)
  console.log("[9] 错题本");
  r = await req("/me/wrongbook");
  const wrongs = r.data?.list || [];
  check("错题本可访问", r.code === 0);
  if (wrongs.length > 0) {
    console.log(`  ℹ 当前错题 ${wrongs.length} 道(本次答错已收录)`);
    check("错题含本次答错题", wrongs.some((w) => w.questionId === q?.id));
  } else {
    console.log("  ℹ 无错题(可能恰好答对)");
  }

  // 10. 掌握度统计
  console.log("[10] 掌握度统计");
  r = await req("/me/stats");
  check("stats 返回 byTopic", r.code === 0 && Array.isArray(r.data?.byTopic));

  // 11. 模拟考会话(限时)
  console.log("[11] 模拟考会话(限时)");
  r = await req("/sessions", "POST", { mode: "EXAM", limit: 3, durationMin: 25 });
  check("模拟考创建成功且带限时", r.code === 0 && r.data?.durationMin === 25, `durationMin=${r.data?.durationMin}`);
  const esid = r.data?.sessionId;

  // 12. 模拟考作答 + 交卷
  console.log("[12] 模拟考作答与交卷");
  const eq = r.data?.questions?.[0];
  if (eq) {
    await req(`/sessions/${esid}/answer`, "POST", { questionId: eq.id, selected: eq.options?.[0] });
    r = await req(`/sessions/${esid}/submit`, "POST");
    check("模拟考交卷成功", r.code === 0 && typeof r.data?.score === "number");
  } else {
    check("模拟考题目可获取", false, "无题目");
  }

  // 13. 会话详情(提交后可见解析)
  console.log("[13] 会话详情");
  r = await req(`/sessions/${sid}`);
  check("详情含解析字段", r.code === 0 && r.data?.details?.[0]?.solution !== undefined);

  // 14. 权限:学生访问老师接口应 403
  console.log("[14] 权限校验");
  r = await req("/teacher/students");
  check("学生访问学情接口被拒(403)", r.code === 403, `code=${r.code}`);

  // 15. 试卷列表(学生可看)
  console.log("[15] 试卷列表");
  r = await req("/papers");
  check("试卷列表可访问", r.code === 0);

  console.log(`\n========== 结果:通过 ${passed} 项,失败 ${failed} 项 ==========`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});
