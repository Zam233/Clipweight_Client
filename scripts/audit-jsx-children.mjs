/**
 * 诊断脚本（一次性）：把「会被 React 当子节点渲染、但静态类型是 any/unknown/object」的
 * JSX 表达式全部列出来。
 *
 * 用途：定位 `Objects are not valid as a React child (found: object with keys {name})`
 * 这类崩溃——报错只说"有个对象被当成了子节点"，不说在哪；tsc 因为字段声明成 string
 * 也不会报错。这个脚本用 TS 类型检查器把可疑点位摊开来看。
 *
 * 用法：node scripts/audit-jsx-children.mjs [文件名过滤]
 */
import ts from 'typescript';

const filter = process.argv[2] || '';
const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error('找不到 tsconfig.json');
  process.exit(1);
}
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, '.');
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();

/** 这些类型当子节点是安全的 */
function isSafe(text) {
  if (!text) return true;
  const parts = text.split('|').map((s) => s.trim());
  for (const p of parts) {
    // 只盯「静态类型本身就不保证是标量/元素」的：any / unknown / object / {…}
    if (p === 'any' || p === 'unknown' || p === 'object' || p === '{}') return false;
    if (/^\{[\s\S]*\}$/.test(p)) return false;
    if (/^\{\s*\[key: string\]: any\s*\}$/.test(p)) return false;
  }
  return true;
}

const hits = [];
let total = 0;
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.includes('src') || !/\.tsx$/.test(sf.fileName)) continue;
  if (filter && !sf.fileName.includes(filter)) continue;

  const walk = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      for (const child of node.children) {
        if (ts.isJsxExpression(child) && child.expression) {
          total++;
          const type = checker.getTypeAtLocation(child.expression);
          const text = checker.typeToString(type);
          if (!isSafe(text)) {
            const { line } = sf.getLineAndCharacterOfPosition(child.getStart());
            hits.push(`${sf.fileName}:${line + 1}  [${text}]  {${child.expression.getText().slice(0, 80)}}`);
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

console.log(`检查 ${total} 个 JSX 子表达式，可疑 ${hits.length} 处：`);
for (const h of hits) console.log('  ' + h);
