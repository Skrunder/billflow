import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useCategories, useDeleteCategory, useSaveCategory } from '../api/hooks';
import type { Category, CategoryType } from '@skr/core';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CategoryDot, EmptyState, PageHeader } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../hooks/useCanEdit';

const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

function CategoryRow({ category, canEdit, onDelete }: { category: Category; canEdit: boolean; onDelete: (c: Category) => void }) {
  const save = useSaveCategory();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: category.id, name: name.trim(), color },
      { onSuccess: () => setEditing(false), onError: (err) => toast.error(errorMessage(err)) },
    );
  };

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input type="color" aria-label="Colour" className="h-9 w-10 cursor-pointer rounded-sm border border-slate-300 dark:border-slate-700" value={color} onChange={(e) => setColor(e.target.value)} />
          <input className="input flex-1" aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          <button className="icon-btn text-emerald-600 dark:text-emerald-400" aria-label="Save" disabled={save.isPending}>
            <Check className="h-4 w-4" />
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setEditing(false)}>
            <X className="h-4 w-4" />
          </button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <CategoryDot color={category.color} className="h-3.5 w-3.5" />
      <span className="flex-1 text-sm font-medium">{category.name}</span>
      <span className="text-xs text-slate-500">{category.usageCount} item{category.usageCount === 1 ? '' : 's'}</span>
      {canEdit && (
        <>
          <button className="icon-btn" aria-label={`Edit ${category.name}`} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button className="icon-btn hover:text-red-600 dark:hover:text-red-400" aria-label={`Delete ${category.name}`} onClick={() => onDelete(category)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </li>
  );
}

function CategoryColumn({ type, title }: { type: CategoryType; title: string }) {
  const { data = [], isLoading } = useCategories(type);
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const toast = useToast();
  const canEdit = useCanEdit();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[data.length % PALETTE.length]!);
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { type, name: name.trim(), color },
      {
        onSuccess: () => {
          setName('');
          setColor(PALETTE[(data.length + 1) % PALETTE.length]!);
          toast.success('Category added');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <section className="card overflow-hidden">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <span className="text-xs text-slate-500">{data.length}</span>
      </div>
      {canEdit && (
        <form onSubmit={add} className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <input type="color" aria-label="New category colour" className="h-9 w-10 cursor-pointer rounded-sm border border-slate-300 dark:border-slate-700" value={color} onChange={(e) => setColor(e.target.value)} />
          <input className="input flex-1" placeholder={`New ${type === 'BILL' ? 'bill' : 'event'} category`} aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button className="btn-primary" disabled={save.isPending || !name.trim()}>
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        </form>
      )}
      {isLoading ? (
        <LoadingBlock />
      ) : data.length ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.map((c) => (
            <CategoryRow key={c.id} category={c} canEdit={canEdit} onDelete={setToDelete} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={Tags} title="No categories" />
      )}
      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Delete “${toDelete?.name}”?`}
        message={`${toDelete?.usageCount ?? 0} item(s) use this category. They will NOT be deleted — they just become uncategorised.`}
        confirmLabel="Delete category"
        danger
        busy={del.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              setToDelete(null);
              toast.success('Category deleted');
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </section>
  );
}

export function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categories" subtitle="Organise bills and events your way. Colours appear on the calendar." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CategoryColumn type="BILL" title="Bill categories" />
        <CategoryColumn type="EVENT" title="Event categories" />
      </div>
    </>
  );
}
