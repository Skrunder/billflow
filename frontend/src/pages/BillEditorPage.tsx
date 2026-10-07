import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useBill, useSaveBill } from '../api/hooks';
import { BillForm } from '../components/bills/BillForm';
import { PageHeader } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

export function BillEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: bill, isLoading } = useBill(id);
  const save = useSaveBill();

  if (id && isLoading) return <LoadingBlock />;

  return (
    <>
      <PageHeader title={id ? `Edit ${bill?.name ?? 'bill'}` : 'New bill'} />
      <div className="card max-w-3xl p-4 sm:p-6">
        <BillForm
          key={bill?.id ?? 'new'}
          initial={bill}
          defaultDate={params.get('date')}
          busy={save.isPending}
          onCancel={() => navigate(-1)}
          onSubmit={(input) =>
            save.mutate(
              { id, input },
              {
                onSuccess: (saved) => {
                  toast.success(id ? 'Bill updated' : 'Bill created');
                  navigate(`/bills/${saved.id}`, { replace: true });
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        />
      </div>
    </>
  );
}
