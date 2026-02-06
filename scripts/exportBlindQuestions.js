import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const seedPath = path.join(__dirname, "../seedQuestions.js");
const content = fs.readFileSync(seedPath, "utf8");

// Extract the questions array (between "const questions = [" and "];")
const start =
  content.indexOf("const questions = [") + "const questions = [".length;
let depth = 1;
let end = start;
for (let i = start; i < content.length && depth > 0; i++) {
  if (content[i] === "[") depth++;
  else if (content[i] === "]") depth--;
  end = i;
}
const arrStr = "[" + content.slice(start, end).trim() + "]";
const questions = eval(arrStr);

const out = {};
questions.forEach((q, i) => {
  const key = i < 30 ? `s1_${i}` : `s2_${i - 30}`;
  out[key] = {
    text: q.text,
    o0: q.options[0],
    o1: q.options[1],
    o2: q.options[2],
  };
});

const outPath = path.join(
  __dirname,
  "../../Unlock-Me-Frontend/src/i18n/locales/blindDateQuestionsEn.json"
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("Written", outPath);
