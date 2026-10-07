import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/misc';

export function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState icon={Compass} title="Page not found">
        <Link to="/" className="text-brand-600 hover:underline">
          Back to the dashboard
        </Link>
      </EmptyState>
    </div>
  );
}
