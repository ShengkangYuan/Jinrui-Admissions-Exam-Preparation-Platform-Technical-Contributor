// 与后端 docs/API.md 契约对应的类型定义

export interface User {
  id: string;
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
  /** 账号审核状态:PENDING 待审核 | APPROVED 已通过 | REJECTED 已拒绝 */
  status?: "PENDING" | "APPROVED" | "REJECTED";
  targetUniversity?: string | null;
}

export interface AuthData {
  token: string;
  user: User;
}

export interface Question {
  id: string;
  subject: string;
  /** 题源/试卷类型:TMUA | ESAT | NSAA | 其他(与 subject 科目区分) */
  sourceType?: string | null;
  paper?: string | null;
  topic: string;
  topicIds?: string[] | null; // 关联知识点 id(题库管理用)
  topics?: string[]; // 知识点名称数组(后端解析返回)
  difficulty: number;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC";
  stem: string;
  options: string[]; // 后端返回 JSON 字符串,统一在 api 层解析为数组
  answer?: string;
  solution?: string | null;
  source?: string | null;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "REJECTED" | "ARCHIVED";
  reviewNote?: string | null;
  reviewedAt?: string | null;
  importedAt?: string | null; // 批量导入时间;手动录入为空
  createdAt?: string;
}

export interface QuestionList {
  list: Question[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QuizQuestion {
  id: string;
  subject: string;
  paper?: string | null;
  topic: string;
  difficulty: number;
  type: string;
  stem: string;
  options: string[];
  source?: string | null;
}

export interface CreateSessionData {
  sessionId: string;
  mode: "PRACTICE" | "EXAM";
  durationMin?: number | null;
  questions: QuizQuestion[];
}

export interface GradeResult {
  score: number;
  total: number;
  correctCount: number;
  timedOut?: boolean;
  avgTimeSpent?: number | null;
  details: { questionId: string; selected: string | null; isCorrect: boolean; timeSpent?: number | null }[];
}

export interface SessionSummary {
  id: string;
  mode: "PRACTICE" | "EXAM";
  score: number | null;
  total: number | null;
  correctCount: number | null;
  startedAt: string;
  submittedAt: string | null;
  paperTitle?: string | null;
  assignmentTitle?: string | null;
  paperId?: string | null;
  assignmentId?: string | null;
  answeredCount?: number;
}

export interface SessionDetail {
  id: string;
  mode: string;
  // 服务端当前时间(epoch ms),用于前端校准本机时钟偏移(避免设备时钟偏快时提前禁答)
  serverTime?: number;
  durationMin?: number | null;
  deadlineAt?: string | null;
  pausedRemaining?: number | null;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  startedAt: string;
  submittedAt: string | null;
  answeredCount?: number;
  details: {
    questionId: string;
    selected: string | null;
    isCorrect: boolean | null;
    timeSpent: number | null;
    options: string[];
    answer?: string;
    solution?: string | null;
    stem: string;
    topic: string;
  }[];
}

export interface WrongItem {
  questionId: string;
  topic: string;
  subject: string;
  difficulty: number;
  stem: string;
  answer?: string | null;
  solution?: string | null;
  wrongCount: number;
  mastered: boolean;
}

export interface StatsData {
  byTopic: { topic: string; attempts: number; correctRate: number }[];
  totalAnswered: number;
  correctAnswered: number;
  overallRate: number;
  bySubject: { subject: string; attempts: number; correctRate: number }[];
  byMode: { mode: string; attempts: number; correctRate: number }[];
  byDifficulty: { difficulty: number; attempts: number; correctRate: number }[];
}

// ---- 成长图谱(GET /api/me/growth) ----
export interface GrowthPoint {
  period: string;
  label: string;
  overallRate: number;
  subjects: Record<string, number | null>;
  attempts: number;
}
export interface Milestone {
  id: string;
  date: string;
  type: string;
  icon: string;
  title: string;
  desc: string;
  highlight?: boolean;
}
export interface Coach {
  encouragement: string;
  suggestions: string[];
}
export interface GrowthData {
  points: GrowthPoint[];
  milestones: Milestone[];
  coach: Coach;
  summary?: {
    hasData?: boolean;
    firstDate?: string;
    lastDate?: string;
    spanDays?: number;
    totalAnswered?: number;
    totalSessions?: number;
    peakRate?: number;
    maxStreak?: number;
  };
}

// ---- 试卷(含套题自动组卷) ----

/** 卷内题目的审核分布 */
export interface PaperStats {
  total: number;
  published: number;
  pending: number;
  rejected: number;
  draft: number;
  archived: number;
  /** 卷内引用的题目已被删除的数量 */
  missing: number;
}

export interface PaperRow {
  id: string;
  title: string;
  subject: string;
  /** 题源/试卷类型:TMUA | ESAT | NSAA | 其他 */
  sourceType?: string | null;
  questionCount: number;
  createdAt: string;
  /** 以下字段仅老师视角返回 */
  source?: string | null;
  /** MANUAL = 手动组卷;AUTO_SET = 套题录入自动成卷 */
  origin?: "MANUAL" | "AUTO_SET";
  /** OFFICIAL = 官方原版套题(如 PDF 导入真题);CUSTOM = 组卷套题(手动组卷或自编导入);mock = 模考套题(批量导入的模拟卷) */
  kind?: "OFFICIAL" | "CUSTOM" | "mock";
  /** DRAFT = 还有题没审完;READY = 全部通过,学生可作答;ARCHIVED = 已下架 */
  status?: "DRAFT" | "READY" | "ARCHIVED";
  stats?: PaperStats;
}

export interface PaperManageQuestion {
  id: string;
  index: number;
  missing: boolean;
  subject?: string;
  paper?: string | null;
  topic?: string;
  difficulty?: number;
  type?: string;
  stem?: string;
  options?: string[];
  answer?: string;
  solution?: string | null;
  status?: Question["status"];
  reviewNote?: string | null;
  source?: string | null;
}

export interface PaperManageDetail {
  id: string;
  title: string;
  subject: string;
  /** 题源/试卷类型:TMUA | ESAT | NSAA | 其他 */
  sourceType?: string | null;
  source?: string | null;
  origin?: "MANUAL" | "AUTO_SET";
  status: "DRAFT" | "READY" | "ARCHIVED";
  createdAt: string;
  stats: PaperStats;
  questions: PaperManageQuestion[];
}

// ---- 退回题目一键自动修正 ----

export interface AutoFixDiff {
  code: string;
  label: string;
  field: string;
  before: string;
  after: string;
  why?: string;
  /** 是否由退回意见中的关键词定向命中 */
  targeted?: boolean;
}

export interface AutoFixManual {
  code: string;
  label: string;
  detail?: string;
  targeted?: boolean;
}

export interface AutoFixPlan {
  id: string;
  applied: boolean;
  status?: Question["status"];
  reviewNote?: string | null;
  fixes: AutoFixDiff[];
  manual: AutoFixManual[];
  patch: Record<string, unknown>;
  /** 修正后仍存在的问题;为空表示体检通过 */
  remaining: string[];
  clean: boolean;
  targetedCodes: string[];
  noteMatched: boolean;
  preview: {
    stem: string;
    options: string[];
    answer: string;
    solution: string;
    difficulty: number;
  };
}

export interface AutoFixBatchItem {
  id: string;
  stem: string;
  reviewNote: string | null;
  fixCount: number;
  fixes: { code: string; label: string; field: string; targeted?: boolean }[];
  manual: AutoFixManual[];
  remaining: string[];
  clean: boolean;
  willResubmit: boolean;
}

// AI 按退回原因语义重调(question-fixer skill)的预览/结果结构
export interface AiFixChange {
  field: string;
  reason: string;
}
export interface AiFixPlan {
  id: string;
  applied: boolean;
  reviewNote?: string | null;
  fixed: {
    stem: string;
    options: string[];
    answer: string;
    solution: string;
    difficulty: number;
  };
  changes: AiFixChange[];
  /** 修正后仍待人工复核的问题;为空表示体检通过 */
  remaining: string[];
  clean: boolean;
  model?: string;
}

// ---- 学生分组(老师可按组布置作业/考试) ----
export interface GroupStudent {
  id: string;
  name: string;
  email: string;
  status: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  memberCount: number;
  students: GroupStudent[];
}

// ---- 分组已布置的模考 / 作业(GET /api/teacher/groups/:id/assignments) ----
export interface GroupAssignmentStats {
  total: number;
  submitted: number;
  inProgress: number;
  notSubmitted: number;
  avgScore: number | null;
  avgAccuracy: number | null;
}

export interface GroupAssignment {
  id: string;
  title: string;
  /** PRACTICE = 作业;EXAM = 模考 */
  mode: "PRACTICE" | "EXAM";
  note: string | null;
  dueAt: string | null;
  createdAt: string;
  kind: "SUBJECT" | "LANGUAGE" | "UNKNOWN";
  paperTitle: string | null;
  subject: string | null;
  stats: GroupAssignmentStats;
}

