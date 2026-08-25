import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listEntries, openVault, readFields, updateFields } from './lib.mjs';

const tools = [
  {
    name: 'passman_list_entries',
    description: 'List Passman vault entry metadata. Secret field values are never returned.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'passman_read_fields',
    description: 'Read explicitly requested fields from one Passman vault entry. Requested secret values are returned to the MCP client.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['item', 'fields'],
      properties: { item: { type: 'string', minLength: 1 }, fields: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } } },
    },
  },
  {
    name: 'passman_update_fields',
    description: 'Update protected custom fields on one Passman vault entry. Values are never echoed back.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['item', 'values'],
      properties: { item: { type: 'string', minLength: 1 }, values: { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } } },
    },
  },
];

function text(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

export async function startMcpServer() {
  const server = new Server({ name: 'passman', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments || {};
      const vault = await openVault();
        if (request.params.name === 'passman_list_entries') return text(await listEntries(vault));
      if (request.params.name === 'passman_read_fields') {
        const item = requiredString(args.item, 'item');
        if (!Array.isArray(args.fields) || args.fields.some((field) => typeof field !== 'string' || !field.trim())) throw new Error('fields must be a non-empty array of strings');
        return text(await readFields(vault, item, args.fields));
      }
      if (request.params.name === 'passman_update_fields') {
        const item = requiredString(args.item, 'item');
        if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values) || Object.values(args.values).some((value) => typeof value !== 'string')) throw new Error('values must be a non-empty object of string fields');
        await updateFields(vault, item, args.values);
        return text({ updated: Object.keys(args.values).sort() });
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return text(error?.message || String(error), true);
    }
  });
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  startMcpServer().catch((error) => {
    process.stderr.write(`passman MCP: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}