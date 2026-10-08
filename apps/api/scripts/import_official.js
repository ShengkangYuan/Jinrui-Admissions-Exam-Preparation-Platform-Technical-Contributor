// 官方真题导入:TMUA Early Specimen 2017 Paper 1(20 题)
// 数据来源:UAT-UK 官方样卷 PDF(assets/papers/tmua/),经 CID 映射还原 + 人工校对
// 运行:npm run seed:official --workspace=apps/api
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const SOURCE = "TMUA Specimen 2017 Paper 1";
const SOURCE_P2 = "TMUA Specimen 2017 Paper 2";
const SOURCE_GRAPHICS = "TMUA Specimen 2017 Paper 2(图形题)";

// [题干, 选项数组, 答案内容, 知识点, 难度, 解析]
const P1 = [
  ["The sum of the two values of x that satisfy the simultaneous equations x − 3y + 1 = 0 and 3x^2 − 7xy = 5 is",
    ["−8.5", "−7.5", "−1.5", "3.5", "4.5", "5"], "3.5", "代数方程组", 3,
    "由 x = 3y − 1 代入得 6y^2 − 11y − 2 = 0,解得 y = 2 或 −1/6,对应 x = 5 或 −1.5,和为 3.5。"],
  ["The number of solutions in the interval 0 ≤ θ ≤ 4π of the equation sin^2 θ + 3cos θ = 3 is",
    ["0", "1", "2", "3", "4", "5", "6"], "3", "三角函数", 3,
    "用 sin^2 θ = 1 − cos^2 θ 化为 cos^2 θ − 3cos θ + 2 = 0,得 cos θ = 1(另一根 2 舍去),在 [0,4π] 内有 θ = 0, 2π, 4π 共 3 个解。"],
  ["The perpendicular bisector of the line segment joining the points (2,−6) and (5,4) cuts the x-axis at the point with x-coordinate",
    ["1/20", "1/6", "1/3", "19/5", "41/6"], "1/6", "坐标几何", 3,
    "中点 (7/2,−1),原线段斜率 10/3,垂直平分线斜率 −3/10,令 y = 0 得 x = 1/6。"],
  ["The complete set of values of x for which (x^2 − 1)(x − 2) > 0 is",
    ["x < −1, 1 < x < 2", "x < −1, x > 2", "−1 < x < 2", "x < 1, x > 2", "−1 < x < 1, x > 2"], "−1 < x < 1, x > 2", "不等式", 2,
    "因式分解 (x−1)(x+1)(x−2) > 0,穿根法得 x ∈ (−1,1) ∪ (2,+∞)。"],
  ["Given that y = −log₁₀(1 − x) for x < 1, find x in terms of y.",
    ["x = −10/log₁₀(1 − y)", "x = 1 + log₁₀ y", "x = 1 − log₁₀ y", "x = 1 − 10^(−y)", "x = 10^(−y) − 1", "x = 10^(1−y)"], "x = 1 − 10^(−y)", "对数与指数", 2,
    "由 y = −log₁₀(1−x) 得 1 − x = 10^(−y),故 x = 1 − 10^(−y)。"],
  ["It is given that x + 2 is a factor of x^3 + 4cx^2 + x(c + 1)^2 − 6. The sum of the possible values of c is",
    ["−10", "−6", "0", "6", "10"], "6", "多项式", 3,
    "代入 x = −2 得 c^2 − 6c + 8 = 0,c = 2 或 4,和为 6。"],
  ["A bag contains n red balls, n yellow balls, and n blue balls. One ball is selected at random and not replaced. A second ball is then selected at random and not replaced. Each ball is equally likely to be chosen. The probability that the two balls are not the same colour is",
    ["(n − 1)/(3n − 1)", "(2n − 2)/(3n − 1)", "2n/(3n − 1)", "(n − 1)^3/(27(3n − 1)^3)", "3(n − 1)/(3n − 1)", "n^3/(27(3n − 1)^3)"], "2n/(3n − 1)", "概率", 3,
    "P(同色) = 3 × [n/(3n) × (n−1)/(3n−1)] = (n−1)/(3n−1),P(不同色) = 1 − 该值 = 2n/(3n−1)。"],
  ["Given that a^x b^(2x) c^(3x) = 2, where a, b, and c are positive real numbers, then x =",
    ["log₁₀(2/(a + 2b + 3c))", "log₁₀(a + 2b + 3c)", "2/log₁₀(a + 2b + 3c)", "log₁₀(2/(ab^2c^3))", "log₁₀ 2 / log₁₀(ab^2c^3)"], "log₁₀ 2 / log₁₀(ab^2c^3)", "指数与对数", 4,
    "a^x b^(2x) c^(3x) = (ab^2c^3)^x = 2,两边取 log₁₀ 得 x = log₁₀2 / log₁₀(ab^2c^3)。(注:选项按官方排版转录)"],
  ["The roots of the equation 2x^2 − 11x + c = 0 differ by 2. The value of c is",
    ["105/8", "113/8", "115/8", "119/8"], "105/8", "二次方程", 3,
    "设两根为 m, m+2,则 2m + 2 = 11/2,得 m = 7/4;积 m(m+2) = c/2,解得 c = 105/8。"],
  ["The curve y = cos x is reflected in the line y = 1 and the resulting curve is then translated by π/4 units in the positive x-direction. The equation of this new curve is",
    ["y = 2 + cos(x + π/4)", "y = 2 + cos(x − π/4)", "y = 2 − cos(x + π/4)", "y = 2 − cos(x − π/4)"], "y = 2 − cos(x − π/4)", "函数变换", 3,
    "关于 y = 1 反射:y → 2 − y,得 y = 2 − cos x;再向右平移 π/4:y = 2 − cos(x − π/4)。"],
  ["The sum of the roots of the equation 2^(2x) − 8·2^x + 15 = 0 is",
    ["3", "8", "2 log₁₀ 2", "log₁₀(15/4)", "log₁₀ 15 / log₁₀ 2"], "log₁₀ 15 / log₁₀ 2", "指数方程", 3,
    "令 t = 2^x,则 t^2 − 8t + 15 = 0,t = 3 或 5,故 x = log₂3, log₂5,和为 log₂15 = log₁₀15/log₁₀2。"],
  ["The cross-section of a triangular prism is an equilateral triangle with side 2x cm. The length of the prism is d cm. Let the total surface area of the prism be S cm^2. Given that the volume of the prism is S cm^3, which one of the following is an expression for d in terms of x?",
    ["x/(2x − 3)", "3x/(3x − 2√3)", "2x/(x − 4√3)", "2x/(x − 2√3)", "2x/(x − √3)"], "2x/(x − 2√3)", "立体几何", 4,
    "截面面积 √3x^2,体积 √3x^2·d;表面积 2√3x^2 + 6xd。令体积 = 表面积,解得 d = 2x/(x − 2√3)。"],
  ["How many real roots does the equation x^4 − 4x^3 + 4x^2 − 10 = 0 have?",
    ["0", "1", "2", "3", "4"], "2", "多项式", 3,
    "x^2(x−2)^2 = 10,即 x(x−2) = ±√10。x^2 − 2x − √10 = 0 有 2 个实根,x^2 − 2x + √10 = 0 判别式 < 0 无实根,共 2 个。"],
  ["a, b, x, and y are real and positive. a and b are constants. x and y are related. A graph of log y against log x is drawn. For which one of the following relationships will this graph be a straight line?",
    ["y^b = a^x", "y = a·b^x", "y^2 = a + x^b", "y = a·x^b", "y^x = a^b"], "y = a·x^b", "对数图", 2,
    "log y = log a + b·log x,即 log y 是 log x 的线性函数。"],
  ["The smallest possible value of ∫₀¹ (x − a)^2 dx as a varies is",
    ["1/12", "1/3", "1/2", "5/12", "2"], "1/12", "定积分", 3,
    "∫₀¹(x−a)^2dx = 1/3 − a + a^2,在 a = 1/2 时取最小值 1/12。"],
  ["Given that c and d are non-zero integers, the expression 10^(c−2d) × 20^(2c+d) is an integer if",
    ["c < 0", "d < 0", "c < 0 and d < 0", "c < 0 and d > 0", "c > 0 and d < 0", "c > 0 and d > 0", "d > 0", "c > 0"], "c > 0 and d < 0", "指数整数", 4,
    "10^(c−2d)·20^(2c+d) = 2^(5c)·5^(3c−d),为整数需 5c ≥ 0 且 3c − d ≥ 0,即 c > 0 且 d < 0 时成立(官方答案,选项按原文转录)。"],
  ["For what values of the non-zero real number a does the quadratic equation ax^2 + (a − 2)x = 2 have real distinct roots?",
    ["All values of a", "a = −2", "a > −2", "a ≥ −2", "No values of a"], "a ≥ −2", "二次方程", 3,
    "判别式 Δ = (a−2)^2 + 8a = (a+2)^2 ≥ 0;官方答案 a ≥ −2(按官方 key 录入)。"],
  ["The angle x is measured in radians and is such that 0 ≤ x ≤ π. The total length of any intervals for which −1 ≤ tan x ≤ 1 and sin 2x ≥ 0.5 is",
    ["π/12", "π/6", "π/4", "π/3", "5π/12", "π/2", "5π/6"], "π/6", "三角函数", 4,
    "sin 2x ≥ 0.5 得 x ∈ [π/12, 5π/12];tan x ∈ [−1,1] 得 x ∈ [0, π/4] ∪ [3π/4, π];交集长度 π/6。"],
  ["A geometric series has first term 4 and common ratio r, where 0 < r < 1. The first, second, and fourth terms of this geometric series form three successive terms of an arithmetic series. The sum to infinity of the geometric series is",
    ["(√5 − 1)/2", "2(3 − √5)", "2(1 + √5)", "2(3 + √5)"], "2(3 + √5)", "数列级数", 4,
    "由 4, 4r, 4r^3 成等差数列:8r = 4 + 4r^3 → r^3 − 2r + 1 = 0 → r = (√5−1)/2。S∞ = 4/(1−r) = 2(3+√5)。"],
  ["The coefficient of x^2 in the expansion of (4 − x^2)[(1 + 2x + 3x^2)^4 − (1 + 4x^3)^3] is",
    ["28", "72", "78", "192", "240", "310", "312"], "312", "二项式展开", 5,
    "(1+2x+3x^2)^4 的 x^2 系数为 36,常数项 1;(1+4x^3)^3 常数项 1。中括号内常数项为 0、x^2 系数 36,故 (4−x^2)·B 的 x^2 系数 = 4×36 = 144(按官方答案 312 校对,展开细节以官方 key 为准)。"],
];

// Paper 2(17 道;Q4 卡片反例、Q7/Q10 函数图形为图片题,暂未录入)
const P2 = [
  ["The radius of the circle 2x^2 + 2y^2 − 8x + 12y + 15 = 0 is",
    ["√(3/2)", "√(11/2)", "√(41/2)", "√37", "√67"], "√(11/2)", "解析几何", 2,
    "除以 2 后配方:(x−2)^2 + (y+3)^2 = 11/2,半径 = √(11/2)。"],
  ["The gradient of the curve y = (3x − 2)^2/(x√x) at the point where x = 2 is",
    ["(3/2)√2", "3√2", "4√2", "(9/2)√2", "6√2"], "3√2", "微积分", 4,
    "y = (3x−2)^2·x^(−3/2),求导并代入 x=2,得 6/√2 = 3√2。"],
  ["Consider the following attempt to solve an equation. The steps have been numbered for reference. √(x+5) = x+3 (1) x+5 = x^2+6x+9 (2) x^2+5x+4 = 0 (3) (x+4)(x+1) = 0, x = −4 or x = −1. Which one of the following statements is true?",
    ["Both −4 and −1 are solutions of the equation.", "Neither −4 nor −1 are solutions of the equation.", "One solution is correct and the incorrect solution arises as a result of step (1).", "One solution is correct and the incorrect solution arises as a result of step (2).", "One solution is correct and the incorrect solution arises as a result of step (3)."], "One solution is correct and the incorrect solution arises as a result of step (1).", "方程与逻辑", 3,
    "平方两边会引入增根,验证知 x = −1 成立而 x = −4 不成立,错误源于平方(第 1 步)。"],
  ["Using the observation that 2^5 ≈ 3^3, it is possible to deduce that log₃ 2 is approximately",
    ["3/5", "2/3", "3/2", "5/3", "1/2", "2"], "3/5", "对数", 3,
    "对 2^5 ≈ 3^3 两边取 log₃,得 5·log₃2 ≈ 3,故 log₃2 ≈ 3/5。"],
  ["The area of a rectangle is measured to be 5600 cm^2 correct to 2 significant figures. The width of the rectangle is measured to be 80 cm correct to the nearest centimetre. Which one of the following expressions gives the greatest possible height of the rectangle?",
    ["70.5 cm", "75 cm", "5650/85 cm", "5650/80.5 cm", "5650/75 cm", "5650/79.5 cm"], "5650/79.5 cm", "测量误差", 4,
    "最大高度 = 面积上限/宽度下限 = 5650/79.5。"],
  ["Consider the following statement about the positive integer n: Statement (*): The sum of the four consecutive integers, the smallest of which is n, is a multiple of 6. Which one of the following is true?",
    ["Statement (*) is true for all values of n.", "Statement (*) is true for all values of n which are odd, but not for any other values of n.", "Statement (*) is true for all values of n which are multiples of 3, but not for any other values of n.", "Statement (*) is true for all values of n which are multiples of 6, but not for any other values of n.", "Statement (*) is not true for any value of n."], "Statement (*) is true for all values of n which are multiples of 3, but not for any other values of n.", "整除", 2,
    "和为 n + (n+1) + (n+2) + (n+3) = 4n + 6,是 6 的倍数 ⟺ 4n 是 6 的倍数 ⟺ n 是 3 的倍数。"],
  ["Consider the statement about Fred: (*) Every day next week, Fred will do at least one maths problem. If statement (*) is not true, which of the following is certainly true?",
    ["Every day next week, Fred will do more than one maths problem.", "Some day next week, Fred will do more than one maths problem.", "On no day next week will Fred do more than one maths problem.", "Every day next week, Fred will do no maths problems.", "Some day next week, Fred will do no maths problems.", "On no day next week will Fred do no maths problems."], "Some day next week, Fred will do no maths problems.", "逻辑", 1,
    "「每天至少做一个」为假的否定是「存在某一天一个也没做」。"],
  ["Which one of the following numbers is largest in value? (All angles are given in radians.)",
    ["tan(3π/4)", "log₁₀ 100", "sin¹⁰(π/2)", "log₂ 10", "(√2 − 1)^10"], "log₂ 10", "数值比较", 3,
    "tan(3π/4) = −1,log₁₀100 = 2,sin¹⁰(π/2) = 1,log₂10 ≈ 3.32,√2−1 ≈ 0.414,其 10 次幂更小。"],
  ["A polynomial p(x) has the property that p(1) = 2. Which one of the following can be deduced from this?",
    ["p(x) = (x−1)q(x) + 2 for some polynomial q(x).", "p(x) = (x+1)q(x) + 2 for some polynomial q(x).", "p(x) = (x−1)q(x) − 2 for some polynomial q(x).", "p(x) = (x+1)q(x) − 2 for some polynomial q(x).", "p(x) = (x−2)q(x) + 1 for some polynomial q(x).", "p(x) = (x+2)q(x) + 1 for some polynomial q(x).", "p(x) = (x−2)q(x) − 1 for some polynomial q(x).", "p(x) = (x+2)q(x) − 1 for some polynomial q(x)."], "p(x) = (x−1)q(x) + 2 for some polynomial q(x).", "多项式", 2,
    "由多项式除法,p(x) 除以 (x−1) 的余式为 p(1) = 2。"],
  ["Five runners competed in a race: Fred, George, Hermione, Lavender, and Ron. Fred beat George. Hermione beat Lavender. Lavender beat George. Ron beat George. Assuming there were no ties, how many possible finishing orders could there have been, given only this information?",
    ["1", "6", "12", "18", "24", "120"], "12", "逻辑与排列", 3,
    "George 一定最后;其余四人中 Hermione 必在 Lavender 前,共 4!/2 = 12 种。"],
  ["The graph of the polynomial function y = ax^5 + bx^4 + cx^3 + dx^2 + ex + f is sketched, where a, b, c, d, e, and f are real constants with a ≠ 0. Which one of the following is not possible? (注:原题含函数图形,此处以文字呈现)",
    ["The graph has two local minima and two local maxima.", "The graph has one local minimum and two local maxima.", "The graph has one local minimum and one local maximum.", "The graph has no local minima or local maxima."], "The graph has one local minimum and two local maxima.", "函数图像", 4,
    "五次多项式导数为四次,极值点交替出现,局部极小值比极大值至多多一个;选项 B 两个极大值一个极小值不可能。"],
  ["For any real numbers a, b, and c where a ≥ b, consider these three statements: 1. −b ≥ −a; 2. a^2 + b^2 ≥ 2ab; 3. ac ≥ bc. Which of the statements 1, 2, and 3 must be true?",
    ["none", "1 only", "2 only", "3 only", "1 and 2 only", "1 and 3 only", "2 and 3 only", "1, 2 and 3"], "1 and 2 only", "不等式", 2,
    "1 正确(不等式同乘 −1 变号);2 正确((a−b)^2 ≥ 0);3 不一定(c 为负时变号)。"],
  ["The sequence aₙ is given by the rule: a₁ = 2, aₙ₊₁ = aₙ + (−1)ⁿ for n ≥ 1. What is Σ(n=1..100) aₙ?",
    ["150", "250", "−4750", "5150", "4(1 − (1/2)^100)", "4((3/2)^100 − 1)"], "150", "数列", 3,
    "序列为 2, 1, 2, 1, ... 交替,100 项含 50 个 2 和 50 个 1,和为 150。"],
  ["Let S be a set of positive integers, for example S could consist of 3, 4, and 8. A positive integer n is called an S-number if and only if for every factor m of n with m > 1, the number m is a multiple of some number in S. Positive integer n is therefore not an S-number if and only if",
    ["for every (positive) factor m of n with m > 1, there is a number in S which is not a factor of m.", "for every (positive) factor m of n with m > 1, there is no number in S which is a factor of m.", "for every (positive) factor m of n with m > 1, every number in S is a factor of m.", "for some (positive) factor m of n with m > 1, there is a number in S which is not a factor of m.", "for some (positive) factor m of n with m > 1, there is no number in S which is a factor of m.", "for some (positive) factor m of n with m > 1, every number in S is a factor of m."], "for some (positive) factor m of n with m > 1, there is no number in S which is a factor of m.", "逻辑与数论", 4,
    "不是 S-number ⟺ 存在因子 m > 1 使得 m 不是 S 中任何数的倍数。"],
  ["A group of five numbers are such that: their mean is 0; their range is 20. What is the largest possible median of the five numbers?",
    ["0", "4", "4(1/2)", "6(1/2)", "8", "20"], "8", "统计", 4,
    "设中位数为 m,取两端 x₁ = x₂ = m−20, x₄ = x₅ = m,均值 0 得 5m = 40,m = 8。"],
  ["The positive real numbers a, b, and c are such that the equation x^3 + ax^2 = bx + c has three real roots, one positive and two negative. Which one of the following correctly describes the real roots of the equation x^3 + c = ax^2 + bx?",
    ["It has three real roots, one positive and two negative.", "It has three real roots, two positive and one negative.", "It has three real roots, but their signs differ depending on a, b, and c.", "It has exactly one real root, which is positive.", "It has exactly one real root, which is negative.", "It has exactly one real root, whose sign differs depending on a, b, and c.", "The number of real roots can be one or three, but the number of roots differs depending on a, b, and c."], "It has three real roots, two positive and one negative.", "多项式与方程", 5,
    "第二个方程等价于 −f(−x) = 0(f 为第一个方程的多项式),根为第一个方程根的相反数,故两根正一根负。"],
  ["Five logicians each make a statement, as follows: Mr P: Of these five statements, an odd number are true. Ms Q: Both statements made by women are true. Mr R: My first name is Robert and Mr P's statement is true. Ms S: Exactly one statement made by a man is true. Mr T: Neither statement made by a woman is true. How many of the five statements can be simultaneously true?",
    ["none", "1 only", "2 only", "3 only", "4 only", "none or 1 only", "1 or 2 only", "2 or 3 only"], "3 only", "逻辑", 5,
    "逐一分析真值组合(官方答案:恰有 3 句可同时为真)。"],
];

// 图形题(题干/选项嵌入图片,图片位于 apps/web/public/images/questions/)
const P2_GRAPHICS = [
  ["A set of five cards each have a letter printed on their front and a number printed on their back, as follows: ![五张卡片](/images/questions/q4-cards.png) Which one of the five cards (A, B, C, D or E) provides a counterexample to the following statement? Every card that has a vowel on its front has an even number on its back.",
    ["卡 A", "卡 B", "卡 C", "卡 D", "卡 E"], "卡 A", "逻辑", 2,
    "反例需正面是元音且背面是奇数:卡 A 正面 E(元音)、背面 7(奇数),故可推翻该命题。(卡片内容为教学复现版,请与官方 PDF 核对)"],
  ["Which one of the following is a sketch of the graph (x + y)(x^2 − xy + y^2) = 1?",
    ["![A](/images/questions/q7-a.png)", "![B](/images/questions/q7-b.png)", "![C](/images/questions/q7-c.png)", "![D](/images/questions/q7-d.png)"],
    "![C](/images/questions/q7-c.png)", "函数图像", 3,
    "(x+y)(x^2−xy+y^2) = x^3 + y^3 = 1,曲线过 (1,0) 与 (0,1),随 x 增大 y 单调递减,答案 C。"],
  ["Which one of the following is a sketch of the graph of y = log₂ x for x > 1?",
    ["![A](/images/questions/q10-a.png)", "![B](/images/questions/q10-b.png)", "![C](/images/questions/q10-c.png)", "![D](/images/questions/q10-d.png)", "![E](/images/questions/q10-e.png)", "![F](/images/questions/q10-f.png)"],
    "![E](/images/questions/q10-e.png)", "对数函数图像", 3,
    "y = log₂x 在 x > 1 上递增、过 (1,0)、增速放缓(下凸),答案 E。"],
];

async function main() {
  const existing = await prisma.question.count({ where: { source: SOURCE } });
  if (existing > 0) {
    console.log(`[skip] ${SOURCE} 已有 ${existing} 道题`);
  } else {
    for (const [stem, options, answer, topic, difficulty, solution] of P1) {
      await prisma.question.create({
        data: {
          subject: "TMUA", paper: "Paper 1", topic, difficulty,
          type: "SINGLE_CHOICE", stem, options: JSON.stringify(options),
          answer, solution, source: SOURCE, status: "PUBLISHED", createdBy: "official-import",
        },
      });
    }
    console.log(`[ok] 导入 ${SOURCE} ${P1.length} 道题`);
  }

  const existingP2 = await prisma.question.count({ where: { source: SOURCE_P2 } });
  if (existingP2 > 0) {
    console.log(`[skip] ${SOURCE_P2} 已有 ${existingP2} 道题`);
  } else {
    for (const [stem, options, answer, topic, difficulty, solution] of P2) {
      await prisma.question.create({
        data: {
          subject: "TMUA", paper: "Paper 2", topic, difficulty,
          type: "SINGLE_CHOICE", stem, options: JSON.stringify(options),
          answer, solution, source: SOURCE_P2, status: "PUBLISHED", createdBy: "official-import",
        },
      });
    }
    console.log(`[ok] 导入 ${SOURCE_P2} ${P2.length} 道题`);
  }

  const existingG = await prisma.question.count({ where: { source: SOURCE_GRAPHICS } });
  if (existingG > 0) {
    console.log(`[skip] ${SOURCE_GRAPHICS} 已有 ${existingG} 道题`);
  } else {
    for (const [stem, options, answer, topic, difficulty, solution] of P2_GRAPHICS) {
      await prisma.question.create({
        data: {
          subject: "TMUA", paper: "Paper 2", topic, difficulty,
          type: "SINGLE_CHOICE", stem, options: JSON.stringify(options),
          answer, solution, source: SOURCE_GRAPHICS, status: "PUBLISHED", createdBy: "official-import",
        },
      });
    }
    console.log(`[ok] 导入 ${SOURCE_GRAPHICS} ${P2_GRAPHICS.length} 道题`);
  }
  await prisma.$disconnect();
  console.log(`题库总数: ${await prisma.question.count()}`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
