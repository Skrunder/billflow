import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useEvent, useSaveEvent } from '../api/hooks';
import { EventForm } from '../components/events/EventForm';
import { PageHeader } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';

export function EventEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: event, isLoading } = useEvent(id);
  const save = useSaveEvent();

  if (id && isLoading) return <LoadingBlock />;

  return (
    <>
      <PageHeader title={id ? `Edit ${event?.title ?? 'event'}` : 'New event'} />
      <div className="card max-w-3xl p-4 sm:p-6">
        <EventForm
          key={event?.id ?? 'new'}
          initial={event}
          defaultDate={params.get('date')}
          busy={save.isPending}
          onCancel={() => navigate(-1)}
          onSubmit={(input) =>
            save.mutate(
              { id, input },
              {
                onSuccess: (saved) => {
                  toast.success(id ? 'Event updated' : 'Event created');
                  navigate(`/events/${saved.id}`, { replace: true });
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
