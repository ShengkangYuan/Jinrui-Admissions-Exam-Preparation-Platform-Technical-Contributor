// 预置 A Level 基础数学/物理/化学/生物的主要知识点(英文名称,幂等:只新增不存在的,不覆盖老师已建的/改过的)
// 运行:npm run seed:knowledge 或 node scripts/seed_knowledge.js
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const KNOWLEDGE = {
  数学: [
    "Algebra and Functions", "Quadratics", "Coordinate Geometry", "Sequences and Series", "Binomial Expansion",
    "Exponentials and Logarithms", "Trigonometry", "Differentiation", "Integration", "Numerical Methods", "Vectors",
    "Statistics", "Probability", "Mechanics",
  ],
  物理: [
    "Quantities and Units", "Kinematics", "Dynamics and Newton's Laws", "Work, Energy and Power", "Momentum and Collisions",
    "Materials and Deformation of Solids", "Wave Properties", "Stationary Waves and Interference", "Diffraction", "Electric Circuits",
    "Electric Fields", "Magnetic Fields and Electromagnetic Induction", "Capacitance", "Thermal Physics", "Ideal Gases",
    "Quantum Physics", "Particle Physics", "Nuclear Physics", "Astrophysics",
  ],
  化学: [
    "Atomic Structure", "Stoichiometry and Moles", "Chemical Bonding", "Redox Reactions", "Energetics and Enthalpy",
    "Reaction Kinetics", "Chemical Equilibrium", "Acid-Base Equilibria", "Electrochemistry", "Periodicity",
    "Inorganic Chemistry", "Transition Metals", "Organic Chemistry Basics", "Hydrocarbons", "Halogenoalkanes",
    "Alcohols", "Carbonyl Compounds", "Carboxylic Acids and Esters", "Nitrogen Compounds", "Polymers", "Analytical Chemistry",
  ],
  生物: [
    "Cell Structure", "Biological Molecules", "Enzymes", "Cell Membranes and Transport", "Cell Division",
    "DNA and Protein Synthesis", "Genetics and Variation", "Gene Technology", "Ecology", "Biodiversity and Classification",
    "Circulatory System", "Gas Exchange and Respiration", "Digestion", "Nervous System", "Endocrine System",
    "Immune System", "Plant Physiology", "Excretion and Homeostasis", "Evolution",
  ],
};

let added = 0;
let totalPlanned = 0;
for (const [subject, names] of Object.entries(KNOWLEDGE)) {
  totalPlanned += names.length;
  const existing = await prisma.knowledgePoint.findMany({ where: { subject }, select: { name: true } });
  const have = new Set(existing.map((e) => e.name));
  const toAdd = names.filter((n) => !have.has(n)).map((name, i) => ({ subject, name, sortOrder: i + 1 }));
  if (toAdd.length) {
    const res = await prisma.knowledgePoint.createMany({ data: toAdd });
    added += res.count;
  }
}
const total = await prisma.knowledgePoint.count();
console.log(`预置完成:新增 ${added} 个,跳过(已存在) ${totalPlanned - added} 个,库内共 ${total} 个知识点`);
await prisma.$disconnect();
