import { eq, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;
  const name = `${pfx}-tag`;

  h.test('tag create: returns name + label', () => {
    const t = h.j(['tag', 'create', '--name', name, '--label', 'My Label'], 'tag create');
    eq(t.name, name, 'name');
    eq(t.label, 'My Label', 'label');
  });

  h.test('tag list: contains the created tag', () => {
    const list = h.j(['tag', 'list'], 'tag list');
    const found = list.find((t) => t.name === name);
    ok(found, 'list contains tag');
    eq(found.label, 'My Label', 'label round-trip');
  });

  h.test('tag create: same name upserts the label', () => {
    const t = h.j(['tag', 'create', '--name', name, '--label', 'Renamed'], 'tag upsert');
    eq(t.label, 'Renamed', 'label updated');
    const list = h.j(['tag', 'list'], 'tag list after upsert');
    eq(list.filter((x) => x.name === name).length, 1, 'no duplicate tag row');
  });

  h.test('tag list: output is an array of tag objects', () => {
    const list = h.j(['tag', 'list'], 'tag list shape');
    ok(Array.isArray(list), 'array');
    ok(list.every((t) => typeof t.name === 'string' && typeof t.label === 'string'), 'name/label strings');
  });
}
