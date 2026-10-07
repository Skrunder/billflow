import { useCategories } from '../../api/hooks';
import type { CategoryType } from '@skr/core';

export function CategorySelect({
  id,
  type,
  value,
  onChange,
}: {
  id: string;
  type: CategoryType;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { data = [] } = useCategories(type);
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Uncategorised</option>
      {data.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
