#!/usr/bin/env bun
import { spawn } from 'child_process';
import { callAgent, listEntries, openVault, readFields, updateFields, upsertFields, deleteEntry } from './lib.mjs';

function fail(message) {
  process.stderr.write(`passman: ${message}\n`);
  process.exitCode = 1;
}

function parseRef(value) {
  const match = String(value || '').match(/^passman:\/\/([^/]+)\/(.+)$/i);
  if (!match) throw new Error('Expected passman://ITEM/FIELD');
  return { item: decodeURIComponent(match[1]), field: match[2] };
}

async function stdinJson() {
  const text = await new Response(Bun.stdin.stream()).text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('stdin JSON must be an object');
  return data;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log('passman data commands require Passman desktop agent access: list, read, get, item create|edit|delete, run');
    return;
  }
  await openVault();
  if (command === 'list') {
    for (const entry of await listEntries()) console.log(`${entry.title}${entry.username ? `  (${entry.username})` : ''}`);
    return;
  }
  if (command === 'read') {
    const { item, field } = parseRef(args[0]);
    process.stdout.write(`${(await readFields(null, item, [field]))[field] || ''}\n`);
    return;
  }
  if (command === 'get') {
    const item = args[0];
    if (!item) throw new Error('Usage: passman get <item> [--reveal]');
    const fields = await readFields(null, item, ['Title', 'UserName', 'Password', 'URL', 'Notes', 'id']);
    const reveal = args.includes('--reveal');
    console.log(`Title:    ${fields.Title || ''}`);
    console.log(`Username: ${fields.UserName || ''}`);
    console.log(`Password: ${reveal ? fields.Password || '' : fields.Password ? '********' : ''}`);
    console.log(`URL:      ${fields.URL || ''}`);
    console.log(`Notes:    ${fields.Notes || ''}`);
    return;
  }
  if (command === 'item') {
    const [subcommand, item] = args;
    if (subcommand === 'create') {
      const body = await stdinJson();
      const entry = await upsertFields(null, String(body.title || 'Untitled'), {
        UserName: String(body.username || ''), Password: String(body.password || ''), URL: String(body.url || ''), Notes: String(body.notes || ''),
      }, { protectedFields: ['Password'] });
      console.log(JSON.stringify({ id: entry.id, title: entry.title }));
      return;
    }
    if (subcommand === 'edit') {
      if (!item) throw new Error('Usage: passman item edit <item> < json');
      const body = await stdinJson();
      const values = {};
      if ('username' in body) values.UserName = String(body.username || '');
      if ('password' in body) values.Password = String(body.password || '');
      if ('url' in body) values.URL = String(body.url || '');
      if ('notes' in body) values.Notes = String(body.notes || '');
      if ('title' in body) values.Title = String(body.title || '');
      await updateFields(null, item, values, { protectedFields: ['Password'] });
      return;
    }
    if (subcommand === 'delete') {
      if (!item) throw new Error('Usage: passman item delete <item>');
      await deleteEntry(null, item);
      return;
    }
    throw new Error('Usage: passman item create|edit|delete');
  }
  if (command === 'run') {
    const separator = args.indexOf('--');
    const childArgs = separator >= 0 ? args.slice(separator + 1) : args;
    if (!childArgs.length) throw new Error('Usage: passman run -- <command> [args...]');
    const env = { ...process.env };
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== 'string' || !value.startsWith('passman://')) continue;
      const { item, field } = parseRef(value);
      env[name] = (await readFields(null, item, [field]))[field] || '';
    }
    const child = spawn(childArgs[0], childArgs.slice(1), { stdio: 'inherit', env });
    const code = await new Promise((resolve) => child.on('close', (value) => resolve(value ?? 1)));
    process.exitCode = code;
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => fail(error?.message || String(error)));