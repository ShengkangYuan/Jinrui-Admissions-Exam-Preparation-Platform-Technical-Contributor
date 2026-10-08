// 自动生成 — TMUA 2016 Paper 1(真实考年)
// 来源: TMUA-2016-Paper-1-Interactive.html
// 经 scripts/adapters/sanitize.js 清洗:LaTeX 转 $...$,HTML 标签/表格转可读文本。
// 请勿手改,改源 HTML 后重跑 extract_tmua2016.js。
export default [
  {
    "topic": "Algebra · Binomial",
    "stem": "It is given that the expansion of $(ax+b)^{3}$ is $8x^{3} - px^{2} + 18x - 3\\sqrt{3}$, where $a$, $b$ and $p$ are real constants.\n\nWhat is the value of $p$?",
    "options": [
      "$-12\\sqrt{3}$",
      "$-6\\sqrt{3}$",
      "$-4\\sqrt{3}$",
      "$-\\sqrt{3}$",
      "$\\sqrt{3}$",
      "$4\\sqrt{3}$",
      "$6\\sqrt{3}$",
      "$12\\sqrt{3}$"
    ],
    "answer": "$12\\sqrt{3}$",
    "solution": "Expand $(ax+b)^{3}$:\n\n$a^{3}x^{3} + 3a^{2}b x^{2} + 3ab^{2} x + b^{3}$ must equal $8x^{3} - px^{2} + 18x - 3\\sqrt{3}$.\n\nMatch coefficients:\n\n$a^{3} = 8 \\Rightarrow a = 2$\n $b^{3} = -3\\sqrt{3} \\Rightarrow b = -\\sqrt{3}$\n Check: $3ab^{2} = 3\\cdot 2\\cdot 3 = 18$ ✓\n $-p = 3a^{2}b = 3\\cdot 4\\cdot(-\\sqrt{3}) = -12\\sqrt{3}$\n\nSo $p = 12\\sqrt{3}$.\n\nAnswer: H"
  },
  {
    "topic": "Algebra · Factorisation",
    "stem": "The expression $3x^{3} + 13x^{2} + 8x + a$, where $a$ is a constant, has $(x+2)$ as a factor.\n\nWhich one of the following is a complete factorisation of the expression?",
    "options": [
      "$(x+2)(x-1)(3x-2)$",
      "$(x+2)(x+1)(3x-2)$",
      "$(x+2)(x+1)(3x+2)$",
      "$(x+2)(x-3)(3x+2)$",
      "$(x+2)(x+3)(3x-2)$",
      "$(x+2)(x+3)(3x+2)$"
    ],
    "answer": "$(x+2)(x+3)(3x-2)$",
    "solution": "By the factor theorem, $f(-2) = 0$:\n\n$3(-8) + 13(4) + 8(-2) + a = -24 + 52 - 16 + a = 12 + a = 0$, so $a = -12$.\n\nDivide $3x^{3}+13x^{2}+8x-12$ by $(x+2)$ (or use polynomial long division):\n\n$3x^{3}+13x^{2}+8x-12 = (x+2)(3x^{2}+7x-6)$\n\nFactor the quadratic: $3x^{2}+7x-6 = (3x-2)(x+3)$.\n\nComplete factorisation: $(x+2)(x+3)(3x-2)$ — Answer: E"
  },
  {
    "topic": "Calculus · Normal to curve",
    "stem": "A line is drawn normal to the curve $y = \\dfrac{2}{x^{2}}$ at the point on the curve where $x=1$.\n\nThis line cuts the $x$-axis at $P$ and the $y$-axis at $Q$.\n\nThe length of $PQ$ is:",
    "options": [
      "$\\dfrac{3\\sqrt{5}}{2}$",
      "$\\dfrac{3\\sqrt{17}}{4}$",
      "$\\dfrac{7\\sqrt{17}}{4}$",
      "$\\dfrac{35}{4}$",
      "$\\dfrac{35\\sqrt{5}}{2}$",
      "$\\dfrac{3\\sqrt{17}}{2}$"
    ],
    "answer": "$\\dfrac{7\\sqrt{17}}{4}$",
    "solution": "$y = 2x^{-2}$ gives $\\dfrac{dy}{dx} = -4x^{-3}$. At $x=1$: gradient = $-4$, so the normal has gradient $\\dfrac{1}{4}$.\n\nThe point on the curve is $(1, 2)$. The normal line is:\n\n$y - 2 = \\dfrac{1}{4}(x-1)$\n\nAt $P$ ($y=0$): $-2 = \\dfrac{1}{4}(x-1) \\Rightarrow x = -7$, so $P = (-7, 0)$.\n\nAt $Q$ ($x=0$): $y - 2 = \\dfrac{1}{4}(-1) \\Rightarrow y = \\dfrac{7}{4}$, so $Q = \\left(0, \\dfrac{7}{4}\\right)$.\n\n$|PQ| = \\sqrt{7^{2} + \\left(\\tfrac{7}{4}\\right)^{2}} = \\sqrt{49 + \\tfrac{49}{16}} = \\dfrac{7}{4}\\sqrt{16+1} = \\dfrac{7\\sqrt{17}}{4}$\n\nAnswer: C"
  },
  {
    "topic": "Sequences & Series",
    "stem": "The sequence $a_n$ is defined by the rule:\n\n$a_n = (-1)^{n} - (-1)^{n-1} + (-1)^{n+2}$ for $n \\ge 1$.\n\nFind the value of\n\n$\\displaystyle\\sum_{n=1}^{39} a_n$",
    "options": [
      "$-39$",
      "$-3$",
      "$-1$",
      "$0$",
      "$1$",
      "$3$",
      "$39$"
    ],
    "answer": "$-3$",
    "solution": "Strategy: This looks scary, but the smart move is to compute the first few terms and look for a pattern.\n\n$a_1 = (-1)^{1} - (-1)^{0} + (-1)^{3} = -1 - 1 - 1 = -3$\n\n      $a_2 = (-1)^{2} - (-1)^{1} + (-1)^{4} = 1 + 1 + 1 = 3$\n\n      $a_3 = -3,\\ a_4 = 3,\\ a_5 = -3,\\ldots$\n\nThe pattern is clear: $-3, 3, -3, 3, \\ldots$. Each consecutive pair sums to $0$.\n\nFrom $n=1$ to $39$: we have 19 full pairs (sum = 0) plus the lone term $a_{39} = -3$.\n\n$\\sum_{n=1}^{39} a_n = 0 + 0 + \\cdots + 0 + (-3) = -3$\n\nAnswer: B"
  },
  {
    "topic": "Calculus · Area",
    "stem": "What is the total area enclosed between the curve $y = x^{2} - 1$, the $x$-axis and the lines $x = -2$ and $x = 2$?",
    "options": [
      "$\\dfrac{4}{3}$",
      "$\\dfrac{8}{3}$",
      "$4$",
      "$\\dfrac{16}{3}$",
      "$12$",
      "$16$"
    ],
    "answer": "$4$",
    "solution": "$y = x^{2}-1 = (x+1)(x-1)$ crosses the $x$-axis at $x = \\pm 1$. The parabola dips below the axis between $-1$ and $1$, so the region is split into three pieces.\n\n$\\int_{-2}^{-1}(x^{2}-1)\\,dx = \\left[\\tfrac{x^{3}}{3}-x\\right]_{-2}^{-1} = (-\\tfrac{1}{3}+1) - (-\\tfrac{8}{3}+2) = \\tfrac{2}{3} + \\tfrac{2}{3} = \\tfrac{4}{3}$\n\n$\\int_{-1}^{1}|x^{2}-1|\\,dx = -\\left[\\tfrac{x^{3}}{3}-x\\right]_{-1}^{1} = -\\left(-\\tfrac{4}{3}\\right) = \\tfrac{4}{3}$\n\n$\\int_{1}^{2}(x^{2}-1)\\,dx = \\left[\\tfrac{x^{3}}{3}-x\\right]_{1}^{2} = (\\tfrac{8}{3}-2) - (\\tfrac{1}{3}-1) = \\tfrac{4}{3}$\n\nAll three pieces are equal, so the total area is $\\dfrac{4}{3}+\\dfrac{4}{3}+\\dfrac{4}{3} = 4$.\n\nAnswer: C"
  },
  {
    "topic": "Algebra · Mixtures",
    "stem": "$P$, $Q$, and $R$ are each mixtures of red and white paint.\n\nThe percentage by volume of red paint in $P$ is $30\\%$.\n\nThe percentage by volume of red paint in $Q$ is $20\\%$.\n\nThe mixtures $P$, $Q$, and $R$ are combined in the proportion $12:5:3$ respectively.\n\nIf the resulting mixture contains $25\\%$ by volume of red paint, what percentage by volume of mixture $R$ is red paint?",
    "options": [
      "$25\\%$",
      "$23\\%$",
      "$13\\tfrac{1}{3}\\%$",
      "$19\\tfrac{1}{2}\\%$",
      "$9\\tfrac{3}{4}\\%$",
      "It is impossible to achieve this result."
    ],
    "answer": "$13\\tfrac{1}{3}\\%$",
    "solution": "Set up a table. Let the fraction of red in R be $x$. Total volume = $12+5+3=20$.\n\n      \n        \nPaintVolumeRed\n        \nP12$12\\cdot\\tfrac{3}{10}$\n        \nQ5$5\\cdot\\tfrac{1}{5}$\n        \nR3$3x$\n        \ntotal20$20\\cdot\\tfrac{1}{4}$\n      \n\n$\\tfrac{18}{5} + 1 + 3x = 5$ &nbsp;⟹&nbsp; $3x = \\tfrac{2}{5}$ &nbsp;⟹&nbsp; $x = \\tfrac{2}{15} = 13\\tfrac{1}{3}\\%$\n\nAnswer: C"
  },
  {
    "topic": "Probability",
    "stem": "$60\\%$ of a sports club's members are women and the remainder are men.\n\nThis sports club offers the opportunity to play tennis or cricket. Every member plays exactly one of the two sports.\n\n$\\dfrac{2}{5}$ of the male members of the club play cricket;\n\n$\\dfrac{2}{3}$ of the cricketing members of the club are women.\n\nWhat is the probability that a member of the club, chosen at random, is a woman who plays tennis?",
    "options": [
      "$\\dfrac{1}{5}$",
      "$\\dfrac{7}{25}$",
      "$\\dfrac{1}{3}$",
      "$\\dfrac{11}{25}$",
      "$\\dfrac{3}{5}$"
    ],
    "answer": "$\\dfrac{7}{25}$",
    "solution": "Work with 300 people (LCM-friendly). Then 120 men, 180 women.\n\n$\\tfrac{2}{5}$ of men play cricket: 48 men cricket, 72 men tennis.\n\n$\\tfrac{2}{3}$ of cricketers are women, so women cricketers &nbsp;= $2 \\times$ men cricketers &nbsp;= $96$. Total cricketers = 144.\n\nWomen tennis = $180 - 96 = 84$.\n\n$P(\\text{woman AND tennis}) = \\dfrac{84}{300} = \\dfrac{7}{25}$\n\nAnswer: B"
  },
  {
    "topic": "Trigonometry",
    "stem": "Find the maximum angle $x$ in the range $0^\\circ \\le x \\le 360^\\circ$ which satisfies the equation\n\n$\\\\cos^{2}(2x) + \\sqrt{3}\\,\\\\sin(2x) - \\dfrac{7}{4} = 0$",
    "options": [
      "$30^\\circ$",
      "$60^\\circ$",
      "$120^\\circ$",
      "$150^\\circ$",
      "$210^\\circ$",
      "$240^\\circ$",
      "$300^\\circ$",
      "$330^\\circ$"
    ],
    "answer": "$240^\\circ$",
    "solution": "Rewrite $\\\\cos^{2}(2x) = 1 - \\\\sin^{2}(2x)$:\n\n$(1-\\\\sin^{2} 2x) + \\sqrt{3}\\,\\\\sin 2x - \\tfrac{7}{4} = 0$\n\n      $\\\\sin^{2} 2x - \\sqrt{3}\\,\\\\sin 2x + \\tfrac{3}{4} = 0$\n\nThis is a quadratic in $\\\\sin 2x$. Discriminant: $3 - 4\\cdot\\tfrac{3}{4} = 0$. So:\n\n$\\\\sin 2x = \\dfrac{\\sqrt{3}}{2}$\n\nFor $0 \\le x \\le 360^\\circ$ we have $0 \\le 2x \\le 720^\\circ$. The solutions are $2x = 60^\\circ, 120^\\circ, 420^\\circ, 480^\\circ$.\n\nThe largest $x$ is $240^\\circ$.\n\nAnswer: F"
  },
  {
    "topic": "Geometry · Transformations",
    "stem": "The line segment joining the points $(3,3)$ and $(7,5)$ is a diameter of a circle.\n\nThis circle is translated by 3 units in the negative $x$-direction, then reflected in the $x$-axis, and then enlarged by a scale factor of 4 about the centre of the resulting circle.\n\nThe equation of the final circle is:",
    "options": [
      "$(x-2)^{2} + (y-4)^{2} = 320$",
      "$(x-2)^{2} + (y+4)^{2} = 320$",
      "$(x-2)^{2} + (y-4)^{2} = 80$",
      "$(x-2)^{2} + (y+4)^{2} = 80$",
      "$(x-2)^{2} + (y-4)^{2} = 20$",
      "$(x-2)^{2} + (y+4)^{2} = 20$"
    ],
    "answer": "$(x-2)^{2} + (y+4)^{2} = 80$",
    "solution": "Original centre is the midpoint of the diameter: $\\left(\\tfrac{3+7}{2},\\tfrac{3+5}{2}\\right) = (5,4)$.\n\nOriginal radius: $\\tfrac{1}{2}\\sqrt{(7-3)^{2}+(5-3)^{2}} = \\tfrac{1}{2}\\sqrt{20} = \\sqrt{5}$.\n\nTrack the centre and radius through each transformation:\n\n        \n          \nCentreRadius\n          \noriginal(5,4)$\\sqrt{5}$\n          \nafter translation(2,4)$\\sqrt{5}$\n          \nafter reflection(2,−4)$\\sqrt{5}$\n          \nafter enlargement(2,−4)$4\\sqrt{5}$\n        \n\nEquation: $(x-2)^{2} + (y+4)^{2} = (4\\sqrt{5})^{2} = 80$.\n\nAnswer: D"
  },
  {
    "topic": "Trigonometry · Equations",
    "stem": "How many solutions does the equation $x\\\\tan x = 1$ have in the interval $-2\\pi \\le x \\le 2\\pi$?",
    "options": [
      "$0$",
      "$1$",
      "$2$",
      "$3$",
      "$4$",
      "$5$",
      "$6$"
    ],
    "answer": "$4$",
    "solution": "Rewrite as $\\\\tan x = \\dfrac{1}{x}$ (note $x=0$ is not a solution of the original, so we can divide). Sketches of $y=\\\\tan x$ and $y=\\tfrac{1}{x}$:\n\n      \n\n        \n- Each branch of $\\\\tan x$ goes from $-\\infty$ to $+\\infty$ over an interval of width $\\pi$.\n        \n- $\\tfrac{1}{x}$ is positive for $x>0$, negative for $x<0$, and shrinks toward 0 as $|x|$ grows.\n      \n\nOn $[-2\\pi, 2\\pi]$ there are four branches of $\\\\tan x$ (from $-2\\pi$ to $-\\pi$, $-\\pi$ to $0$, $0$ to $\\pi$, $\\pi$ to $2\\pi$). On each branch, $\\\\tan x$ sweeps every real value and crosses $\\tfrac{1}{x}$ exactly once.\n\nTotal crossings: 4\n\nAnswer: E"
  },
  {
    "topic": "Algebra · Exponentials",
    "stem": "The real roots of the equation $4^{2x} + 12 = 2^{2x+3}$ are $p$ and $q$, where $p > q$.\n\nThe value of $p - q$ can be expressed as:",
    "options": [
      "$\\dfrac{3}{4}$",
      "$1$",
      "$4$",
      "$-\\dfrac{1}{2} + \\\\log_{10}\\dfrac{3}{2}$",
      "$\\dfrac{\\\\log_{10}3}{\\\\log_{10}4}$",
      "$\\dfrac{\\\\log_{10}3}{\\\\log_{10}2}$"
    ],
    "answer": "$\\dfrac{\\\\log_{10}3}{\\\\log_{10}4}$",
    "solution": "Let $y = 2^{2x}$. Then $4^{2x} = (2^{2})^{2x} = 2^{4x} = y^{2}$, and $2^{2x+3} = 8y$.\n\n$y^{2} + 12 = 8y$ &nbsp;⟹&nbsp; $y^{2} - 8y + 12 = 0$ &nbsp;⟹&nbsp; $(y-2)(y-6) = 0$\n\nSo $y = 6$ or $y = 2$, i.e. $2^{2p} = 6$ and $2^{2q} = 2$.\n\n$2p = \\\\log_2 6$ &nbsp;⟹&nbsp; $p = \\dfrac{\\\\log_{10}6}{2\\\\log_{10}2}$\n\n      $2q = 1$ &nbsp;⟹&nbsp; $q = \\dfrac{1}{2}$\n\nTherefore:\n\n$p - q = \\dfrac{\\\\log_{10}6}{2\\\\log_{10}2} - \\dfrac{1}{2} = \\dfrac{\\\\log_{10}6 - \\\\log_{10}2}{2\\\\log_{10}2} = \\dfrac{\\\\log_{10}3}{\\\\log_{10}4}$\n\nAnswer: E"
  },
  {
    "topic": "Calculus · 3D Optimisation",
    "stem": "A right circular cylinder is contained within a sphere of radius $5$ cm in such a way that the whole of the circumferences of both ends of the cylinder are in contact with the sphere.\n\nThe diagram shows a planar cross section through the centre of the sphere and cylinder.\n\n  \n  \n  \n  \n  r\n  5\n  h\n  [diagram not to scale]\n\nFind, in cubic centimetres, the maximum possible volume of the cylinder.",
    "options": [
      "$250\\pi$",
      "$500\\pi$",
      "$1000\\pi$",
      "$\\dfrac{250\\sqrt{3}}{3}\\pi$",
      "$\\dfrac{500\\sqrt{3}}{9}\\pi$",
      "$\\dfrac{1000\\sqrt{3}}{9}\\pi$"
    ],
    "answer": "$\\dfrac{500\\sqrt{3}}{9}\\pi$",
    "solution": "Let $h$ = half the cylinder's height (so full height = $2h$), and $r$ = radius. The right triangle in the cross-section has:\n\n$h^{2} + r^{2} = 5^{2} = 25$\n\nVolume of the cylinder:\n\n$V = \\pi r^{2} (2h) = 2\\pi(25 - h^{2})h = 2\\pi(25h - h^{3})$\n\nMaximise: $\\dfrac{dV}{dh} = 2\\pi(25 - 3h^{2}) = 0$ &nbsp;⟹&nbsp; $h = \\dfrac{5}{\\sqrt{3}}$.\n\n$V = 2\\pi\\left(25 - \\tfrac{25}{3}\\right)\\cdot\\tfrac{5}{\\sqrt{3}} = 2\\pi\\cdot\\tfrac{50}{3}\\cdot\\tfrac{5}{\\sqrt{3}} = \\dfrac{500\\pi}{3\\sqrt{3}} = \\dfrac{500\\sqrt{3}}{9}\\pi$\n\nAnswer: E"
  },
  {
    "topic": "Calculus · Number of roots",
    "stem": "How many real roots does the equation $3x^{5} - 10x^{3} - 120x + 30 = 0$ have?",
    "options": [
      "$1$",
      "$2$",
      "$3$",
      "$4$",
      "$5$"
    ],
    "answer": "$3$",
    "solution": "We can't solve a quintic directly, but we can sketch the graph by finding its stationary points.\n\n$f'(x) = 15x^{4} - 30x^{2} - 120 = 15(x^{4} - 2x^{2} - 8) = 15(x^{2}-4)(x^{2}+2)$\n\nStationary at $x = \\pm 2$. Evaluate $f$ at these:\n\n$f(-2) = -96 + 80 + 240 + 30 = 254 > 0$ (local max)\n\n      $f(2) = 96 - 80 - 240 + 30 = -194 < 0$ (local min)\n\nSince the leading coefficient is positive, the graph rises from $-\\infty$, has a local max above the axis, dips to a local min below the axis, then rises to $+\\infty$. It crosses the $x$-axis 3 times.\n\nAnswer: C"
  },
  {
    "topic": "Sequences · Geometric",
    "stem": "The terms of an infinite series $S$ are formed by adding together the corresponding terms in two infinite geometric series, $T$ and $U$.\n\nThe first term of $T$ and the first term of $U$ are each $4$.\n\nIn order, the first three terms of the combined series $S$ are $8$, $3$, and $\\dfrac{5}{4}$.\n\nWhat is the sum to infinity of $S$?",
    "options": [
      "$\\dfrac{32}{5}$",
      "$\\dfrac{20}{3}$",
      "$\\dfrac{64}{5}$",
      "$\\dfrac{40}{3}$",
      "$16$",
      "$32$"
    ],
    "answer": "$\\dfrac{40}{3}$",
    "solution": "Let the common ratio of $T$ be $R$ and of $U$ be $r$. The first three terms of $S$ are:\n\n$4 + 4 = 8$ &nbsp;✓\n\n      $4R + 4r = 3$ &nbsp;⟹&nbsp; $R + r = \\tfrac{3}{4}$\n\n      $4R^{2} + 4r^{2} = \\tfrac{5}{4}$ &nbsp;⟹&nbsp; $R^{2} + r^{2} = \\tfrac{5}{16}$\n\nFrom the first: $R = \\tfrac{3}{4} - r$. Sub into the second:\n\n$\\left(\\tfrac{3}{4}-r\\right)^{2} + r^{2} = \\tfrac{5}{16}$\n\n      $2r^{2} - \\tfrac{3}{2}r + \\tfrac{1}{4} = 0$ &nbsp;⟹&nbsp; $8r^{2} - 6r + 1 = 0$ &nbsp;⟹&nbsp; $(4r-1)(2r-1) = 0$\n\nSo $\\{r,R\\} = \\{\\tfrac{1}{4}, \\tfrac{1}{2}\\}$. The sum-to-infinity of each series:\n\n$T_\\infty = \\dfrac{4}{1-\\tfrac{1}{4}} = \\dfrac{16}{3}$ &nbsp;,&nbsp; $U_\\infty = \\dfrac{4}{1-\\tfrac{1}{2}} = 8$\n\nTotal: $\\dfrac{16}{3} + 8 = \\dfrac{40}{3}$.\n\nAnswer: D"
  },
  {
    "topic": "Calculus · Gradient",
    "stem": "The least possible value of the gradient of the curve $y = (2x+a)(x-2a)^{2}$ at the point where $x=1$, as $a$ varies, is:",
    "options": [
      "$-\\dfrac{49}{4}$",
      "$-8$",
      "$-\\dfrac{25}{4}$",
      "$\\dfrac{7}{4}$",
      "$\\dfrac{47}{16}$"
    ],
    "answer": "$-\\dfrac{25}{4}$",
    "solution": "Expand the brackets:\n\n$y = (2x+a)(x^{2}-4ax+4a^{2}) = 2x^{3} - 7ax^{2} + 4a^{2}x + 4a^{3}$\n\nDifferentiate:\n\n$\\dfrac{dy}{dx} = 6x^{2} - 14ax + 4a^{2}$\n\nAt $x=1$: gradient = $6 - 14a + 4a^{2} = 4a^{2} - 14a + 6$.\n\nComplete the square in $a$:\n\n$4a^{2} - 14a + 6 = 4\\left(a - \\tfrac{7}{4}\\right)^{2} - \\tfrac{25}{4}$\n\nThe least possible value is $-\\dfrac{25}{4}$ (attained at $a=\\tfrac{7}{4}$).\n\nAnswer: C"
  },
  {
    "topic": "Algebra · Logarithms",
    "stem": "Given the simultaneous equations\n\n$\\\\log_{10}2 + \\\\log_{10}(y-1) = 2\\\\log_{10}x$\n\n$\\\\log_{10}(y+3-3x) = 0$\n\nthe values of $y$ are:",
    "options": [
      "$\\dfrac{5}{2} \\pm \\dfrac{3\\sqrt{5}}{2}$",
      "$3 \\pm \\sqrt{3}$",
      "$7 \\pm 3\\sqrt{3}$",
      "$3, 9$",
      "$1, 13$"
    ],
    "answer": "$7 \\pm 3\\sqrt{3}$",
    "solution": "Rewrite the first equation using \\log laws:\n\n$\\\\log_{10}\\bigl(2(y-1)\\bigr) = \\\\log_{10}(x^{2})$ &nbsp;⟹&nbsp; $2(y-1) = x^{2}$\n\nThe second equation (since $\\\\log_a 1 = 0$ for any $a$):\n\n$y + 3 - 3x = 1$ &nbsp;⟹&nbsp; $y = 3x - 2$\n\nSubstitute $x = \\tfrac{y+2}{3}$ into $2y-2 = x^{2}$:\n\n$2y - 2 = \\left(\\tfrac{y+2}{3}\\right)^{2}$\n\n      $18y - 18 = y^{2} + 4y + 4$\n\n      $y^{2} - 14y + 22 = 0$\n\nQuadratic formula:\n\n$y = \\dfrac{14 \\pm \\sqrt{196 - 88}}{2} = \\dfrac{14 \\pm \\sqrt{108}}{2} = 7 \\pm 3\\sqrt{3}$\n\n(Both values give $x>0$ and $y>1$, so both are valid.)\n\nAnswer: C"
  },
  {
    "topic": "Trigonometry · Inequalities",
    "stem": "It is given that\n\n$y = (1 + 2\\\\cos x)\\\\cos 2x$ for $0 < x < \\pi$.\n\nThe complete set of values of $x$ for which $y$ is negative is:",
    "options": [
      "$0 < x < \\dfrac{\\pi}{4},\\; \\dfrac{2\\pi}{3} < x < \\dfrac{3\\pi}{4}$",
      "$0 < x < \\dfrac{\\pi}{4},\\; \\dfrac{3\\pi}{4} < x < \\pi$",
      "$0 < x < \\dfrac{2\\pi}{3},\\; \\dfrac{3\\pi}{4} < x < \\pi$",
      "$\\dfrac{\\pi}{4} < x < \\dfrac{2\\pi}{3},\\; \\dfrac{3\\pi}{4} < x < \\pi$",
      "$\\dfrac{\\pi}{4} < x < \\dfrac{2\\pi}{3}$",
      "$\\dfrac{\\pi}{4} < x < \\dfrac{3\\pi}{4}$"
    ],
    "answer": "$\\dfrac{\\pi}{4} < x < \\dfrac{2\\pi}{3},\\; \\dfrac{3\\pi}{4} < x < \\pi$",
    "solution": "$y = (1+2\\\\cos x)(\\\\cos 2x)$ is negative when the two factors have opposite signs.\n\nFind the zeros in $(0,\\pi)$:\n\n$1+2\\\\cos x = 0$ at $x = \\dfrac{2\\pi}{3}$\n\n      $\\\\cos 2x = 0$ at $x = \\dfrac{\\pi}{4},\\; \\dfrac{3\\pi}{4}$\n\nMake a sign table:\n\n        \n          \n\n              $(0,\\tfrac{\\pi}{4})$\n              $(\\tfrac{\\pi}{4},\\tfrac{2\\pi}{3})$\n              $(\\tfrac{2\\pi}{3},\\tfrac{3\\pi}{4})$\n              $(\\tfrac{3\\pi}{4},\\pi)$\n          \n$1+2\\\\cos x$\n              +\n              +\n              −\n              −\n          \n$\\\\cos 2x$\n              +\n              −\n              −\n              +\n          \n$y$\n              +\n              −\n              +\n              −\n        \n\nSo $y$ is negative on $\\tfrac{\\pi}{4} < x < \\tfrac{2\\pi}{3}$ and $\\tfrac{3\\pi}{4} < x < \\pi$.\n\nAnswer: D"
  },
  {
    "topic": "Calculus · Decreasing",
    "stem": "The function $\\dfrac{1-x}{\\sqrt[3]{x^{2}}}$ is defined for all $x \\ne 0$.\n\nThe complete set of values of $x$ for which the function is decreasing is:",
    "options": [
      "$x \\le -2,\\; x > 0$",
      "$-2 \\le x < 0$",
      "$x \\le 1,\\; x \\ne 0$",
      "$x \\ge 1$",
      "$-2 \\le x \\le 1,\\; x \\ne 0$",
      "$x \\le -2,\\; x \\ge 1$"
    ],
    "answer": "$x \\le -2,\\; x > 0$",
    "solution": "Rewrite: $y = (1-x) x^{-2/3} = x^{-2/3} - x^{1/3}$.\n\n$\\dfrac{dy}{dx} = -\\tfrac{2}{3}x^{-5/3} - \\tfrac{1}{3}x^{-2/3} = -\\tfrac{1}{3}x^{-5/3}(2+x)$\n\n$\\dfrac{dy}{dx}=0$ at $x=-2$ (note $x=0$ is excluded). Sign table (remember $x^{-5/3}=\\tfrac{1}{\\sqrt[3]{x^{5}}}$ has the same sign as $x$):\n\n        \n          \n\n              $x$-2$x>0$\n          \n$x^{-5/3}$\n              −\n              −\n              +\n          \n$2+x$\n              −\n              +\n              +\n          \n$\\tfrac{dy}{dx}$\n              − (decreasing)\n              + (increasing)\n              − (decreasing)\n        \n\nSo $y$ is decreasing for $x \\le -2$ and $x > 0$.\n\nAnswer: A"
  },
  {
    "topic": "Algebra · Binomial coefficients",
    "stem": "The coefficient of $x^{3}$ in the expansion of $(1+2x+3x^{2})^{6}$ is equal to twice the coefficient of $x^{4}$ in the expansion of $(1-ax^{2})^{5}$.\n\nFind all possible values of the constant $a$.",
    "options": [
      "$\\pm 2\\sqrt{2}$",
      "$\\pm \\sqrt{17}$",
      "$\\pm \\sqrt{34}$",
      "$\\pm 2\\sqrt{17}$",
      "There are no possible values of $a$."
    ],
    "answer": "$\\pm \\sqrt{17}$",
    "solution": "Step 1. Coefficient of $x^{3}$ in $(1+(2x+3x^{2}))^{6}$:\n\n$(1+u)^{6} = \\sum_{k=0}^{6} \\binom{6}{k} u^{k}$, where $u = 2x+3x^{2}$. Only $k=2$ and $k=3$ contribute to $x^{3}$.\n      \n\n        \n- $k=2:$ $\\binom{6}{2}(2x+3x^{2})^{2} = 15(4x^{2}+12x^{3}+\\ldots)$, coefficient of $x^{3}$ = $15\\cdot 12 = 180$.\n        \n- $k=3:$ $\\binom{6}{3}(2x+3x^{2})^{3} = 20(8x^{3}+\\ldots)$, coefficient of $x^{3}$ = $20\\cdot 8 = 160$.\n      \n\nTotal coefficient of $x^{3}$ = $180 + 160 = 340$.\n\nStep 2. Coefficient of $x^{4}$ in $(1-ax^{2})^{5}$:\n\n$\\binom{5}{2}(-a)^{2} = 10a^{2}$\n\nStep 3. Set up the equation:\n\n$340 = 2 \\cdot 10a^{2}$ &nbsp;⟹&nbsp; $a^{2} = 17$ &nbsp;⟹&nbsp; $a = \\pm\\sqrt{17}$\n\nAnswer: B"
  },
  {
    "topic": "Geometry · 3D shortest path",
    "stem": "The diagram shows a square-based pyramid with base $PQRS$ and vertex $O$. All the edges of the pyramid are of length $20$ metres.\n\n  \n\n  \n  \n  \n  \n  \n  O\n  S\n  P\n  Q\n  R\n  [diagram not to scale]\n\nFind the shortest distance, in metres, along the outer surface of the pyramid from $P$ to the midpoint of $OR$.",
    "options": [
      "$10\\sqrt{5} - 2\\sqrt{3}$",
      "$10\\sqrt{3}$",
      "$10\\sqrt{5}$",
      "$10\\sqrt{7}$",
      "$10\\sqrt{5} + 2\\sqrt{3}$"
    ],
    "answer": "$10\\sqrt{7}$",
    "solution": "All 8 edges have length 20, so every face is an equilateral triangle of side 20. Let $T$ = midpoint of $OR$.\n\nStrategy: \"Unfold\" the pyramid into a flat net, then the shortest path on the surface becomes a straight line on the net.\n\nThere are two natural routes to consider. Let the height of an equilateral triangle = $20\\\\sin 60^\\circ = 10\\sqrt{3}$.\n\nRoute 1 (across base $PQRS$, then up face $ORS$): Unfolding the base and the face gives $PT^{2} = 700 + 200\\sqrt{3}$.\n\nRoute 2 (across face $OPS$ to edge $OS$, then up face $OSR$ to $T$): Unfolding gives:\n\n$PT^{2} = (15\\sqrt{3})^{2} + 5^{2} = 675 + 25 = 700$ &nbsp;⟹&nbsp; $PT = \\sqrt{700} = 10\\sqrt{7}$\n\nRoute 2 is the shorter of the two.\n\nAnswer: D"
  }
];
