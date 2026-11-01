import { db } from './db';
import {
  settingDefinitions,
  resolveSetting,
  type SettingKey,
  type Settings,
} from './settings-registry';
export async function readSettings() {
  const rows = await db.query.instanceSetting.findMany();
  const fields = Object.entries(settingDefinitions).map(([name, d]) => {
    const key = name as SettingKey;
    const row = rows.find((r) => r.key === key);
    const { schema: _, ...definition } = d;
    void _;
    return {
      key,
      ...definition,
      ...resolveSetting(key, row?.value ?? undefined),
      revision: row?.revision ?? 0,
    };
  });
  return { fields, values: Object.fromEntries(fields.map((f) => [f.key, f.value])) as Settings };
}
