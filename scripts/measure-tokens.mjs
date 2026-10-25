import { execSync } from "child_process";

// Run inside gateway pod
const code = `
const { upstreamPool } = require('./dist/upstream/client-pool.js');
const { canUserAccessTool } = require('./dist/auth/permissions.js');

function optimizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy['$schema'];
  delete copy['title'];
  delete copy['additionalProperties'];
  if (copy.properties) {
    for (const [k, v] of Object.entries(copy.properties)) {
      if (v.description && v.description.length > 80) {
        v.description = v.description.substring(0, 80);
      }
    }
  }
  return copy;
}

(async () => {
  const rawTools = await upstreamPool.listAggregatedTools();
  const adminTools = rawTools.filter(t => canUserAccessTool({ id: 1, email: 'admin@localtest.me', role: 'admin' }, t.name));
  const memberTools = rawTools.filter(t => canUserAccessTool({ id: 2, email: 'member@localtest.me', role: 'member' }, t.name));

  const rawAdmin = adminTools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  const rawMember = memberTools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  const rawAdminChars = JSON.stringify(rawAdmin).length;
  const rawMemberChars = JSON.stringify(rawMember).length;

  const optAdmin = adminTools.map(t => ({
    name: t.name,
    description: (t.description || '').replace(/^\\[[^\\]]+\\]\\s*/, '').substring(0, 85),
    parameters: optimizeSchema(t.inputSchema)
  }));
  const optMember = memberTools.map(t => ({
    name: t.name,
    description: (t.description || '').replace(/^\\[[^\\]]+\\]\\s*/, '').substring(0, 85),
    parameters: optimizeSchema(t.inputSchema)
  }));

  const optAdminChars = JSON.stringify(optAdmin).length;
  const optMemberChars = JSON.stringify(optMember).length;

  console.log('--- TOKEN & PROMPT SIZE MEASUREMENTS ---');
  console.log('BEFORE OPTIMIZATION:');
  console.log('  Admin (12 tools): ' + rawAdminChars + ' chars (~' + Math.round(rawAdminChars / 4) + ' tokens)');
  console.log('  Member (10 tools): ' + rawMemberChars + ' chars (~' + Math.round(rawMemberChars / 4) + ' tokens)');
  console.log('AFTER OPTIMIZATION:');
  console.log('  Admin (12 tools): ' + optAdminChars + ' chars (~' + Math.round(optAdminChars / 4) + ' tokens)');
  console.log('  Member (10 tools): ' + optMemberChars + ' chars (~' + Math.round(optMemberChars / 4) + ' tokens)');
  console.log('SAVINGS:');
  console.log('  Admin Reduction:  ' + (rawAdminChars - optAdminChars) + ' chars (-' + Math.round((1 - optAdminChars / rawAdminChars) * 100) + '%)');
  console.log('  Member Reduction: ' + (rawMemberChars - optMemberChars) + ' chars (-' + Math.round((1 - optMemberChars / rawMemberChars) * 100) + '%)');
  process.exit(0);
})();
`;

const res = execSync(`kubectl -n uai exec deploy/uai-gateway -- node -e "${code.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
console.log(res);
