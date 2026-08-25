import { createConnection } from 'net';
import { homedir } from 'os';
import { join } from 'path';

const SOCKET_PATH = join(homedir(), '.config', 'passman', 'agent.sock');

function unavailable(error) {
  const detail = error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED'
    ? 'Human action required: ask a human to open Passman, unlock the vault, and enable Accessible for agents. An agent cannot enable this access itself.'
    : error?.message || String(error);
  return new Error(detail);
}

export function agentSocketPath() {
  return SOCKET_PATH;
}

export function callAgent(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    let buffer = '';
    const id = crypto.randomUUID();
    socket.once('error', (error) => reject(unavailable(error)));
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) reject(new Error(response.error));
        else resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function openVault() {
  await callAgent('vault.status');
  return { agent: true };
}

export async function listEntries() {
  return (await callAgent('entry.list')).entries;
}

export async function readField(vault, item, field) {
  return (await readFields(vault, item, [field]))[field] || '';
}

export async function readFields(vault, item, fields) {
  return (await callAgent('entry.read', { item, fields })).fields;
}

export async function updateFields(vault, item, values, { protectedFields = Object.keys(values) } = {}) {
  return (await callAgent('entry.upsert', { title: item, values, protectedFields })).entry;
}

export async function upsertFields(vault, title, values, { protectedFields = Object.keys(values) } = {}) {
  return (await callAgent('entry.upsert', { title, values, protectedFields })).entry;
}

export async function deleteEntry(vault, item) {
  await callAgent('entry.delete', { item });
  return true;
}