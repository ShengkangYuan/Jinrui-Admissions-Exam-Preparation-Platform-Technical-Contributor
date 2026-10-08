// 知识点自动匹配的共享规则(中文关键词/英文关键词 → 知识点名)
// 供 importRows 运行时匹配与 classify_existing.js 存量归类共用,保持单一来源。
// 注意:知识点名是英文(A Level 术语),视觉模型 topic 常输出中文,这里做中英桥接。
// 学科字段是「知识点学科」(数学/物理/化学/生物);题目学科需先映射(knowledgeSubjectsFor)。

export const KNOWLEDGE_RULES = [
  { subject: "数学", re: /二次|quadratic/i, kp: "Quadratics" },
  { subject: "数学", re: /二项式|binomial/i, kp: "Binomial Expansion" },
  { subject: "数学", re: /坐标|几何|geometry/i, kp: "Coordinate Geometry" },
  { subject: "数学", re: /数列|级数|递推|sequence|series/i, kp: "Sequences and Series" },
  { subject: "数学", re: /指数|对数|log|exponential/i, kp: "Exponentials and Logarithms" },
  { subject: "数学", re: /三角|trig|sin|cos|tan/i, kp: "Trigonometry" },
  { subject: "数学", re: /微分|导数|单调|differenti|gradient|normal|tangent|optimis|rate of change/i, kp: "Differentiation" },
  { subject: "数学", re: /积分|integral|integration|area/i, kp: "Integration" },
  { subject: "数学", re: /数值|numerical|trapezium/i, kp: "Numerical Methods" },
  { subject: "数学", re: /向量|vector/i, kp: "Vectors" },
  { subject: "数学", re: /概率|probability/i, kp: "Probability" },
  { subject: "数学", re: /统计|statistics/i, kp: "Statistics" },
  { subject: "数学", re: /不等式|inequalit|代数|方程|多项式|factor|algebra|函数|root/i, kp: "Algebra and Functions" },
  { subject: "数学", re: /力学|mechanic/i, kp: "Mechanics" },
  { subject: "物理", re: /运动|kinematic|motion/i, kp: "Kinematics" },
  { subject: "物理", re: /能量|energy|work|power/i, kp: "Work, Energy and Power" },
  { subject: "物理", re: /电路|circuit|current|voltage/i, kp: "Electric Circuits" },
  { subject: "化学", re: /键|bonding/i, kp: "Chemical Bonding" },
  { subject: "化学", re: /平衡|equilibrium/i, kp: "Chemical Equilibrium" },
  { subject: "化学", re: /有机|organic|hydrocarbon/i, kp: "Organic Chemistry Basics" },
  { subject: "生物", re: /细胞|cell/i, kp: "Cell Structure" },
  { subject: "生物", re: /酶|enzyme/i, kp: "Enzymes" },
  { subject: "生物", re: /遗传|gene|genetic/i, kp: "Genetics and Variation" },
];
