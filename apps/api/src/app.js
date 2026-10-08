import express from "express";
import cors from "cors";
import { ok, fail } from "./lib/res.js";
import { llmConfigured } from "./lib/llm.js";
import authRouter from "./routes/auth.js";
import questionsRouter from "./routes/questions.js";
import sessionsRouter from "./routes/sessions.js";
import meRouter from "./routes/me.js";
import growthRouter from "./routes/growth.js";
import teacherRouter from "./routes/teacher.js";
import groupsRouter from "./routes/groups.js";
import examsRouter from "./routes/exams.js";
import papersRouter from "./routes/papers.js";
import interviewRouter from "./routes/interview.js";
import uploadsRouter from "./routes/uploads.js";
import knowledgePointsRouter from "./routes/knowledge-points.js";
import roguelikeRouter from "./routes/roguelike.js";
import languageRouter from "./routes/language.js";
import reviewRequestsRouter from "./routes/review-requests.js";
import teacherAdminRouter from "./routes/teacher-admin.js";
import planningRouter from "./routes/planning.js";

export function createApp() {
  const app = express();
  app.use(cors());
  // 提高上限以支撑 base64 图片/文件上传(默认 100kb 会被 413 拦截;文件 base64 膨胀约 1.33 倍)
  // 需与 nginx client_max_body_size(50m) 对齐
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (req, res) => {
    ok(res, { status: "ok", time: new Date().toISOString(), llmConfigured: llmConfigured() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/me", meRouter);
  app.use("/api/me", growthRouter);
  app.use("/api/teacher", teacherRouter);
  app.use("/api/teacher/groups", groupsRouter);
  app.use("/api/exams", examsRouter);
  app.use("/api/papers", papersRouter);
  app.use("/api/interview", interviewRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/knowledge-points", knowledgePointsRouter);
  app.use("/api/roguelike", roguelikeRouter);
  app.use("/api/language", languageRouter);
  app.use("/api/review-requests", reviewRequestsRouter);
  app.use("/api/teacher/admin", teacherAdminRouter);

  app.use("/api/planning", planningRouter); // 升学规划模块(独立命名空间,与笔试隔离)

  // 404 兜底
  app.use((req, res) => fail(res, 404, "not found"));

  // 统一错误处理
  app.use((err, req, res, next) => {
    console.error("[error]", err);
    fail(res, 500, "服务器内部错误");
  });

  return app;
}
