// 面试练习题导入:Cambridge Mathematics Admissions Interview Questions
// Set A — Number Theory & Combinatorics(STEP 风格,7 题)
// 数据来源:cambridge_maths_interview_set_A.html(题目/提示/解答逐字转录)
// 运行:npm run seed:interview --workspace=apps/api
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const QUESTIONS = [
  {
    subject: "Number Theory",
    tagClass: "nt",
    heading: "Question 1 · The Sophie Germain identity",
    stem:
      "<div class='part'><b>(i)</b> Prove the identity " +
      "<span class='eq'>a<sup>4</sup> + 4b<sup>4</sup> = (a<sup>2</sup> + 2b<sup>2</sup> + 2ab)(a<sup>2</sup> + 2b<sup>2</sup> &minus; 2ab)</span> " +
      "for all integers <span class='eq'>a, b</span>.</div>" +
      "<div class='part'><b>(ii)</b> Deduce that for every integer <span class='eq'>n &gt; 1</span>, the number <span class='eq'>n<sup>4</sup> + 4</span> is composite.</div>" +
      "<div class='part'><b>(iii)</b> Discuss: can <span class='eq'>n<sup>4</sup> + 4</span> ever be prime? If so, find all integers <span class='eq'>n</span> for which it is prime.</div>",
    focus: "algebraic manipulation (completing the square + difference of two squares), " +
      "an \"unexpected\" eye for factorisation, and the precise definition of \"composite\" (you must show both factors are strictly greater than 1). " +
      "A common follow-up is to ask what the two factors are when <code>n = 2</code>, checking whether you actually verified \"&gt; 1\".",
    steps: [
      "<b>(i) The key trick — insert a \"missing\" middle term.</b><br>" +
        "We want to factor a sum, and the standard way to factor a sum is to <i>force</i> it into a difference of two squares: " +
        "X<sup>2</sup> &minus; Y<sup>2</sup> = (X+Y)(X&minus;Y). Start from a<sup>4</sup> + 4b<sup>4</sup> and add and subtract the term 4a<sup>2</sup>b<sup>2</sup> " +
        "(which is exactly what we need to complete a square): " +
        "<span class='eq'>a<sup>4</sup> + 4b<sup>4</sup> = a<sup>4</sup> + 4a<sup>2</sup>b<sup>2</sup> + 4b<sup>4</sup> &minus; 4a<sup>2</sup>b<sup>2</sup> = (a<sup>2</sup> + 2b<sup>2</sup>)<sup>2</sup> &minus; (2ab)<sup>2</sup></span>. " +
        "Now it is a difference of two squares, so " +
        "<span class='eq'>(a<sup>2</sup> + 2b<sup>2</sup>)<sup>2</sup> &minus; (2ab)<sup>2</sup> = (a<sup>2</sup> + 2b<sup>2</sup> + 2ab)(a<sup>2</sup> + 2b<sup>2</sup> &minus; 2ab)</span>, " +
        "which is exactly the required factorisation. This is the <span class='key'>Sophie Germain identity</span>.",
      "<b>(ii) Apply it with b = 1.</b><br>" +
        "Setting b = 1 in (i) gives " +
        "<span class='eq'>n<sup>4</sup> + 4 = (n<sup>2</sup> &minus; 2n + 2)(n<sup>2</sup> + 2n + 2)</span>. " +
        "To call n<sup>4</sup>+4 <i>composite</i> we must show both factors are integers strictly greater than 1. " +
        "<br>&bull; First factor: n<sup>2</sup> &minus; 2n + 2 = (n&minus;1)<sup>2</sup> + 1. Since (n&minus;1)<sup>2</sup> &ge; 0, this is &ge; 1, and it equals 1 only when n = 1. For <b>n &gt; 1</b>, (n&minus;1)<sup>2</sup> &ge; 1, so this factor &ge; 2 &gt; 1. " +
        "<br>&bull; Second factor: n<sup>2</sup> + 2n + 2 = (n+1)<sup>2</sup> + 1 &ge; 5 &gt; 1 for every n &ge; 1. " +
        "<br>Thus for every integer n &gt; 1, n<sup>4</sup>+4 splits into two integers each &gt; 1, so it is composite. " +
        "<br><i>Sanity check at n = 2:</i> factors are (4&minus;4+2) = 2 and (4+4+2) = 10, and indeed 2&middot;10 = 20 = 16+4. Both &gt; 1, as required.",
      "<b>(iii) When can it be prime?</b><br>" +
        "A prime has exactly two positive divisors, 1 and itself, so for a factorisation into two positive integers one factor must equal 1. " +
        "<br>&bull; First factor = 1 &rArr; (n&minus;1)<sup>2</sup> + 1 = 1 &rArr; (n&minus;1)<sup>2</sup> = 0 &rArr; n = 1. Then n<sup>4</sup>+4 = 5, which is prime. " +
        "<br>&bull; Second factor = 1 &rArr; (n+1)<sup>2</sup> + 1 = 1 &rArr; (n+1)<sup>2</sup> = 0 &rArr; n = &minus;1. Then n<sup>4</sup>+4 = 1+4 = 5, also prime. " +
        "<br>&bull; n = 0 gives 4, not prime. For every |n| &gt; 1, part (ii) shows the number is composite. " +
        "<br><b>Conclusion:</b> n<sup>4</sup> + 4 is prime <b>exactly for n = 1 and n = &minus;1</b>, in both cases giving the prime 5.",
    ],
  },
  {
    subject: "Number Theory",
    tagClass: "nt",
    heading: "Question 2 · Difference of squares and factorisation",
    stem:
      "<div class='part'><b>(i)</b> Show that if integers <span class='eq'>x, y</span> have the same parity then <span class='eq'>x<sup>2</sup> &minus; y<sup>2</sup></span> is divisible by 4, while if they have opposite parity then <span class='eq'>x<sup>2</sup> &minus; y<sup>2</sup></span> is odd.</div>" +
      "<div class='part'><b>(ii)</b> Find all pairs of positive integers <span class='eq'>(x, y)</span> satisfying " +
      "<span class='eq'>x<sup>2</sup> &minus; y<sup>2</sup> = 2024</span>.</div>" +
      "<div class='part'><b>(iii)</b> (Generalisation) For which positive integers <span class='eq'>N</span> does <span class='eq'>x<sup>2</sup> &minus; y<sup>2</sup> = N</span> have a solution in positive integers <span class='eq'>(x, y)</span>? Give a necessary and sufficient condition and justify it briefly.</div>",
    focus: "parity classification, and the restriction that the two factors " +
      "<code>(x&minus;y)</code> and <code>(x+y)</code> must share the same parity. Part (iii) separates N by its residue mod 4 — " +
      "this is where the interviewer judges whether you can generalise and summarise cleanly.",
    steps: [
      "<b>(i) Reduce modulo 4.</b><br>" +
        "Any square is 0 or 1 modulo 4. So there are two cases: " +
        "<br>&bull; <i>Same parity.</i> Both x, y even &rArr; their squares are 0, 0 (mod 4); difference 0. Both odd &rArr; squares 1, 1 (mod 4); difference 0. In either sub-case x<sup>2</sup>&minus;y<sup>2</sup> &equiv; 0 (mod 4), i.e. divisible by 4. " +
        "<br>&bull; <i>Opposite parity.</i> One square is 0 and the other is 1 (mod 4), so the difference is 1&minus;0 = 1 or 0&minus;1 &equiv; 3 (mod 4). Either way it is odd.",
      "<b>(ii) Factor and use the same-parity restriction.</b><br>" +
        "Factor: <span class='eq'>x<sup>2</sup> &minus; y<sup>2</sup> = (x&minus;y)(x+y) = 2024</span>. " +
        "Set u = x&minus;y, v = x+y. Then u&middot;v = 2024 and u, v have the <i>same parity</i> (because u+v = 2x is even). " +
        "Since 2024 is even, u and v cannot both be odd, so they must both be even. Write u = 2a, v = 2b with 0 &lt; a &lt; b (we need y = (v&minus;u)/2 = b&minus;a &gt; 0). " +
        "Then 4ab = 2024, so <span class='eq'>ab = 506 = 2 &middot; 11 &middot; 23</span>. " +
        "Factor pairs (a, b) with a &lt; b: <b>(1,506), (2,253), (11,46), (22,23)</b>. " +
        "Recover the integers: x = (u+v)/2 = a+b, y = (v&minus;u)/2 = b&minus;a. " +
        "<br>&bull; (1,506) &rarr; (x,y) = (507, 505) " +
        "<br>&bull; (2,253) &rarr; (255, 251) " +
        "<br>&bull; (11,46) &rarr; (57, 35) " +
        "<br>&bull; (22,23) &rarr; (45, 1) " +
        "<br><i>Check the last one:</i> 45<sup>2</sup> &minus; 1<sup>2</sup> = 2025 &minus; 1 = 2024 &check;. " +
        "These four are all the positive solutions.",
      "<b>(iii) The general condition on N.</b><br>" +
        "As above, write u = x&minus;y, v = x+y, so uv = N with u, v of the same parity and v &gt; u &gt; 0 (the last ensures y &gt; 0). " +
        "<br>&bull; <i>N &equiv; 2 (mod 4).</i> Two numbers of the same parity multiply to either an odd number (both odd) or a multiple of 4 (both even). They can never multiply to a number &equiv; 2 (mod 4). So <b>no solution</b>. " +
        "<br>&bull; <i>N odd.</i> Take u = 1, v = N (both odd, same parity). Then x = (N+1)/2, y = (N&minus;1)/2 are positive integers. So a solution <b>always exists</b> for odd N. " +
        "<br>&bull; <i>N &equiv; 0 (mod 4).</i> Write N = 4M. Then u = 2a, v = 2b with ab = M, and we need b &gt; a &gt; 0. This is possible exactly when M has a factor pair a &lt; b, i.e. when M &ge; 2 (if M = 1 the only pair is a = b = 1, giving y = 0, not positive). So we need N divisible by 4 <b>and N &ge; 8</b>. " +
        "<br><b>Answer:</b> x<sup>2</sup>&minus;y<sup>2</sup> = N has a positive-integer solution iff <b>N is odd, or N is a multiple of 4 with N &ge; 8</b>. (Equivalently: N is not &equiv; 2 mod 4, and N &ne; 4.)",
    ],
  },
  {
    subject: "Number Theory",
    tagClass: "nt",
    heading: "Question 3 · Primes of the forms 4k+1 and 4k+3",
    stem:
      "<div class='part'><b>(i)</b> Let <span class='eq'>p</span> be a prime divisor of <span class='eq'>n<sup>2</sup> + 1</span> for some integer <span class='eq'>n</span>. Prove that <span class='eq'>p = 2</span> or <span class='eq'>p &equiv; 1 (mod 4)</span>.</div>" +
      "<div class='part'><b>(ii)</b> Hence prove that there are infinitely many primes of the form <span class='eq'>4k + 1</span>.</div>" +
      "<div class='part'><b>(iii)</b> Similarly prove that there are infinitely many primes of the form <span class='eq'>4k + 3</span>.</div>",
    focus: "a naive use of Fermat's little theorem and the \"order\" of an element, " +
      "plus a Euclid-style proof by contradiction. Part (i) is the crux: from n<sup>2</sup> &equiv; &minus;1 (mod p) we get n<sup>4</sup> &equiv; 1 (mod p), " +
      "so the order of n is 4, forcing 4 | (p&minus;1). The interviewer watches whether you can translate \"&minus;1 is a quadratic residue\" into the language of orders.",
    steps: [
      "<b>(i) Use the \"order\" of n modulo p.</b><br>" +
        "If p = 2 we are done (n<sup>2</sup>+1 is even when n is odd, so 2 can divide it). Assume p is odd. " +
        "Since p | n<sup>2</sup>+1, we have <span class='eq'>n<sup>2</sup> &equiv; &minus;1 (mod p)</span>. Squaring both sides: <span class='eq'>n<sup>4</sup> &equiv; 1 (mod p)</span>. " +
        "<br>In modular arithmetic, the <i>order</i> of n modulo p is the smallest positive t with n<sup>t</sup> &equiv; 1 (mod p). From n<sup>4</sup> &equiv; 1 we know the order divides 4, so it is 1, 2, or 4. " +
        "<br>&bull; Order 1 would mean n &equiv; 1 (mod p), but then n<sup>2</sup> &equiv; 1, contradicting n<sup>2</sup> &equiv; &minus;1 (since p is odd, 1 &ne; &minus;1). " +
        "<br>&bull; Order 2 would mean n<sup>2</sup> &equiv; 1 (mod p), again contradicting n<sup>2</sup> &equiv; &minus;1. " +
        "<br>So the order must be exactly 4. By Fermat's little theorem, n<sup>p&minus;1</sup> &equiv; 1 (mod p), which says the order (4) divides p&minus;1. Hence <b>4 | (p&minus;1)</b>, i.e. <b>p &equiv; 1 (mod 4)</b>.",
      "<b>(ii) Euclid-style contradiction for 4k+1 primes.</b><br>" +
        "Suppose there were only finitely many primes &equiv; 1 (mod 4); call them q<sub>1</sub>, &hellip;, q<sub>r</sub>. " +
        "Let Q = q<sub>1</sub>q<sub>2</sub>&hellip;q<sub>r</sub> and consider <span class='eq'>N = (2Q)<sup>2</sup> + 1 = 4Q<sup>2</sup> + 1</span>. " +
        "N &gt; 1, so it has an odd prime divisor p. Because p | N = (2Q)<sup>2</sup> + 1, part (i) tells us p &equiv; 1 (mod 4). " +
        "So <i>every</i> odd prime divisor of N is a 4k+1 prime. But p cannot be any of the q<sub>i</sub>: if p = q<sub>i</sub>, then p | Q, and also p | N = 4Q<sup>2</sup>+1, so p divides (4Q<sup>2</sup>+1) &minus; 4Q&middot;Q = 1, impossible. " +
        "Thus p is a <i>new</i> prime &equiv; 1 (mod 4), contradicting \"finitely many\". Therefore there are <b>infinitely many</b> primes of the form 4k+1.",
      "<b>(iii) The same idea for 4k+3 primes.</b><br>" +
        "Suppose only finitely many primes &equiv; 3 (mod 4) exist; call them q<sub>1</sub>, &hellip;, q<sub>r</sub> (3 is one of them). " +
        "Let M = 4(q<sub>1</sub>q<sub>2</sub>&hellip;q<sub>r</sub>) &minus; 1. Then M &equiv; &minus;1 &equiv; 3 (mod 4), and M &gt; 1, so M has a prime divisor p. " +
        "<br>If <i>every</i> prime divisor of M were &equiv; 1 (mod 4), then M itself would be &equiv; 1 (mod 4) (a product of 1-mod-4 numbers is 1 mod 4). But M &equiv; 3 (mod 4), contradiction. Hence M has at least one prime divisor <b>p &equiv; 3 (mod 4)</b>. " +
        "This p cannot be any q<sub>i</sub>: if p = q<sub>i</sub> then p divides the product, hence p | 4(product), and p | M = 4(product) &minus; 1, so p | 1, impossible. So p is a <i>new</i> 4k+3 prime &mdash; contradiction. Hence there are <b>infinitely many</b> primes of the form 4k+3. " +
        "<br><i>Big picture:</i> both proofs are Euclid's \"assume finitely many, build a new one\" trick; the art is choosing N so that every new prime divisor is forced into the desired congruence class.",
    ],
  },
  {
    subject: "Combinatorics",
    tagClass: "comb",
    heading: "Question 4 · The Ramsey number R(3,3)",
    stem:
      "<div class='part'><b>(i)</b> At a party of 6 people, any two are either friends or not friends. Prove that there is someone who has at least 3 friends or at least 3 non-friends.</div>" +
      "<div class='part'><b>(ii)</b> Deduce that among the 6 people, one can always find 3 mutual friends or 3 mutual non-friends (i.e. R(3,3) &le; 6).</div>" +
      "<div class='part'><b>(iii)</b> Construct a configuration of 5 people in which no such triple exists. Hence show R(3,3) &gt; 5.</div>",
    focus: "a natural application of the pigeonhole principle, and an \"extremal construction\" to give a lower bound. " +
      "For (iii) the standard picture is a pentagon: place 5 people at the vertices and declare friendship to be exactly the 5 edges of the pentagon &mdash; " +
      "each vertex then has 2 friends and 2 non-friends, and there is no monochromatic triangle.",
    steps: [
      "<b>(i) Pigeonhole on one person's relationships.</b><br>" +
        "Pick any person, call them A. A relates to the other 5 people, and each relationship is one of two types: friend or non-friend. So the 5 other people split into two groups: Friends(A) and NonFriends(A). " +
        "By the pigeonhole principle, with 5 items in 2 boxes, at least one box contains &lceil;5/2&rceil; = 3 people. So A has at least 3 friends <i>or</i> at least 3 non-friends.",
      "<b>(ii) Turn that into a triangle.</b><br>" +
        "By (i), some person &mdash; still call them A &mdash; has at least 3 friends (the \"3 non-friends\" case is symmetric, just swap the words \"friend\" and \"non-friend\"). Let those 3 friends be B, C, D. " +
        "Now examine the relationships <i>among</i> B, C, D: " +
        "<br>&bull; If any two of them are friends, say B and C, then A, B, C are three mutual friends (A is friends with both, and B, C are friends). That is the required triple. " +
        "<br>&bull; If <i>no</i> two of B, C, D are friends, then B, C, D are three mutual <i>non</i>-friends. That is also the required triple. " +
        "<br>Exactly one of these two cases must occur, so among 6 people there is always a triple of all-friends or all-non-friends. Therefore <b>R(3,3) &le; 6</b>.",
      "<b>(iii) A 5-person counterexample, so R(3,3) &gt; 5.</b><br>" +
        "Arrange 5 people at the vertices of a regular pentagon. Declare two people to be <i>friends</i> exactly when they are joined by a side of the pentagon (the 5 edges). So each person is friends with their two neighbours and is a non-friend of the two opposite vertices. " +
        "<br>Now check all triples of 3 vertices: " +
        "<br>&bull; For 3 mutual <i>friends</i>, we would need all 3 pairwise edges present. But the pentagon is a 5-cycle with no triangle, so that never happens. " +
        "<br>&bull; For 3 mutual <i>non</i>-friends, we would need none of the 3 pairwise edges present. The complement of a 5-cycle is again a 5-cycle, which also has no triangle, so that never happens either. " +
        "<br>Thus with 5 people it is possible to avoid such a triple, so <b>R(3,3) &gt; 5</b>. Combined with (ii), <b>R(3,3) = 6</b>.",
    ],
  },
  {
    subject: "Combinatorics",
    tagClass: "comb",
    heading: "Question 5 · Subsets with no two consecutive elements",
    stem:
      "<div class='part'><b>(i)</b> Let <span class='eq'>f(n)</span> be the number of subsets of <span class='eq'>{1, 2, &hellip;, n}</span> containing no two consecutive integers. Verify " +
      "<span class='eq'>f(1)=2, f(2)=3, f(3)=5</span>.</div>" +
      "<div class='part'><b>(ii)</b> Prove the recurrence <span class='eq'>f(n) = f(n&minus;1) + f(n&minus;2)</span> for n &ge; 3.</div>" +
      "<div class='part'><b>(iii)</b> Write down a closed form for <span class='eq'>f(n)</span> (in terms of Fibonacci numbers or an explicit formula).</div>",
    focus: "building a recurrence by splitting on \"does the subset contain n?\", and the link to the Fibonacci numbers. " +
      "This is the classic three-stage interview pattern &mdash; spot the pattern, prove the recurrence rigorously, then solve it &mdash; and completing all three is a strong signal.",
    steps: [
      "<b>(i) Just list the small cases.</b><br>" +
        "&bull; n = 1, set {1}: subsets are &empty; and {1} &rArr; <b>f(1) = 2</b>. " +
        "<br>&bull; n = 2, set {1,2}: the subset {1,2} is forbidden (1 and 2 are consecutive), so valid subsets are &empty;, {1}, {2} &rArr; <b>f(2) = 3</b>. " +
        "<br>&bull; n = 3, set {1,2,3}: forbidden subsets are those containing a consecutive pair: {1,2}, {2,3}, {1,2,3}. Removing these from the 8 total subsets leaves &empty;, {1}, {2}, {3}, {1,3} &rArr; <b>f(3) = 5</b>.",
      "<b>(ii) Split according to whether the subset contains n.</b><br>" +
        "Take a valid subset of {1, &hellip;, n}. There are two mutually exclusive possibilities: " +
        "<br>&bull; <i>It does not contain n.</i> Then it is simply a valid subset of {1, &hellip;, n&minus;1}. There are f(n&minus;1) of these. " +
        "<br>&bull; <i>It does contain n.</i> Then it cannot contain n&minus;1 (that would be two consecutive integers). So after removing n, the remainder is a valid subset of {1, &hellip;, n&minus;2}. There are f(n&minus;2) of these. " +
        "<br>These two classes are disjoint (one contains n, the other does not) and together account for <i>every</i> valid subset. Hence " +
        "<span class='eq'>f(n) = f(n&minus;1) + f(n&minus;2)</span> &nbsp; for n &ge; 3.",
      "<b>(iii) Identify it as Fibonacci and write the closed form.</b><br>" +
        "The recurrence f(n) = f(n&minus;1) + f(n&minus;2) is exactly the Fibonacci recurrence. With f(1) = 2 = F<sub>3</sub> and f(2) = 3 = F<sub>4</sub> (using F<sub>1</sub> = 1, F<sub>2</sub> = 1), we get " +
        "<span class='eq'>f(n) = F<sub>n+2</sub></span>. " +
        "The explicit formula (Binet's formula) with &phi; = (1+&radic;5)/2 and &psi; = (1&minus;&radic;5)/2 is " +
        "<span class='eq'>f(n) = F<sub>n+2</sub> = (&phi;<sup>n+2</sup> &minus; &psi;<sup>n+2</sup>) / &radic;5</span>. " +
        "<br><i>Check:</i> f(3) = F<sub>5</sub> = 5, matching part (i).",
    ],
  },
  {
    subject: "Combinatorics",
    tagClass: "comb",
    heading: "Question 6 · Handshakes at a party (the subtle pigeonhole)",
    stem:
      "<div class='part'><b>(i)</b> At a party of <span class='eq'>n</span> people, each pair either shakes hands or does not. Explain why a person's number of handshakes lies in <span class='eq'>{0, 1, &hellip;, n&minus;1}</span>.</div>" +
      "<div class='part'><b>(ii)</b> Prove that it is impossible for one person to shake <span class='eq'>n&minus;1</span> hands and another person to shake <span class='eq'>0</span> hands.</div>" +
      "<div class='part'><b>(iii)</b> Deduce that two people must have shaken the same number of hands.</div>",
    focus: "a subtle version of the pigeonhole principle &mdash; the number of available \"pigeonholes\" drops by one because of a mutual-exclusion condition. " +
      "Part (ii) is the hinge: the person who shook everyone's hand forces every other person to have shaken at least one hand, so no one can have shaken 0. The interviewer wants you to spot this first, then close with the pigeonhole principle. " +
      "<br><i>Note:</i> this is the correct, standard form of the classic problem (it is <b>not</b> true for tournament win counts, where a transitive ordering gives scores n&minus;1, n&minus;2, &hellip;, 0, all distinct).",
    steps: [
      "<b>(i) Trivial bounds on the count.</b><br>" +
        "A given person can shake hands with at most the other n&minus;1 people, and at least 0 people. So their handshake count is an integer in the set {0, 1, &hellip;, n&minus;1}. There are n possible values for n people.",
      "<b>(ii) Why 0 and n&minus;1 cannot both occur.</b><br>" +
        "Suppose person A shakes n&minus;1 hands. That means A shook hands with <i>everyone</i> else &mdash; in particular, A shook hands with person B. But then B shook hands with at least one person (namely A). So B cannot have 0 handshakes. " +
        "Hence it is impossible to have simultaneously someone with n&minus;1 handshakes and someone with 0 handshakes.",
      "<b>(iii) Apply the pigeonhole principle.</b><br>" +
        "In principle the n people could have n different counts, namely all of {0, 1, &hellip;, n&minus;1}. But part (ii) shows that the two extreme values 0 and n&minus;1 cannot both appear. So at most <b>n&minus;1</b> distinct handshake counts are actually possible. " +
        "We have n people distributed among at most n&minus;1 possible counts. By the pigeonhole principle, at least two people must share the same count &mdash; i.e. <b>two people shook the same number of hands</b>. " +
        "<br><i>Why this works but the tournament version fails:</i> in the handshake setting, \"A shook everyone\" forces a <i>lower</i> bound (everyone shook &ge; 1), creating the mutual exclusion. In a tournament, \"A won every game\" puts no such bound on others' win counts, so all distinct scores are possible.",
    ],
  },
  {
    subject: "Combinatorics · Bonus",
    tagClass: "comb",
    heading: "Question 7 · Double counting a combinatorial identity",
    stem:
      "<div class='part'><b>(i)</b> Prove by combinatorial argument that " +
      "<span class='eq'>&sum;<sub>k=0</sub><sup>n</sup> C(n, k)<sup>2</sup> = C(2n, n)</span>.</div>" +
      "<div class='part'><b>(ii)</b> (Extension) Prove, from this or otherwise, that " +
      "<span class='eq'>&sum;<sub>k=0</sub><sup>r</sup> C(m, k) C(n, r&minus;k) = C(m+n, r)</span> (Vandermonde's identity).</div>",
    focus: "the \"double counting\" idea &mdash; count the same set in two ways and equate the results. " +
      "This elegant proof is a Cambridge favourite; if you volunteer a generating-function or induction approach, you will be encouraged to develop it.",
    steps: [
      "<b>(i) Count the same thing two ways.</b><br>" +
        "Left side: &sum; C(n,k)<sup>2</sup>. Right side: C(2n, n), the number of ways to choose n people from a group of 2n. " +
        "<br>Interpretation: split the 2n people into two labelled groups A and B, each of size n. Choosing n people from the whole set can be done by picking k people from A and n&minus;k people from B, for some k between 0 and n. " +
        "<br>For a fixed k, the number of ways is C(n, k) &middot; C(n, n&minus;k) = C(n, k)<sup>2</sup> (since C(n, n&minus;k) = C(n, k)). " +
        "<br>Summing over all k = 0, 1, &hellip;, n counts every n-person subset exactly once, and gives &sum;<sub>k=0</sub><sup>n</sup> C(n,k)<sup>2</sup>. Therefore &sum; C(n,k)<sup>2</sup> = C(2n, n).",
      "<b>(ii) The same idea with unequal groups (Vandermonde).</b><br>" +
        "Start with m+n people split into group A of size m and group B of size n. The number of ways to choose r people from the whole set is C(m+n, r). " +
        "<br>Classify by how many come from A: choose k from A and r&minus;k from B, where k = 0, 1, &hellip;, r. For each k the count is C(m, k) &middot; C(n, r&minus;k). " +
        "<br>Summing over k gives every r-person subset exactly once, so " +
        "<span class='eq'>&sum;<sub>k=0</sub><sup>r</sup> C(m, k) C(n, r&minus;k) = C(m+n, r)</span>. " +
        "<br><i>Connection:</i> setting m = n recovers part (i), because C(n, r&minus;k) = C(n, n&minus;(r&minus;k)) and with r = n this becomes C(n,k).",
    ],
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const existed = await prisma.interviewQuestion.findFirst({
      where: { heading: q.heading },
    });
    if (existed) {
      console.log(`[skip] 已存在: ${q.heading}`);
      skipped++;
      continue;
    }
    await prisma.interviewQuestion.create({
      data: {
        subject: q.subject,
        tagClass: q.tagClass,
        heading: q.heading,
        stem: q.stem,
        focus: q.focus,
        steps: JSON.stringify(q.steps),
        sortOrder: i,
        status: "PUBLISHED",
      },
    });
    console.log(`[ok] 导入: ${q.heading}`);
    created++;
  }
  console.log(`\n面试题导入完成:新增 ${created} 题,跳过 ${skipped} 题,共 ${QUESTIONS.length} 题`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
