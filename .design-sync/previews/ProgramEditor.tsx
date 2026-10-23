import { ProgramEditor } from 'mill-dashboard';
import { installMockFetch, programs } from './_mock';

installMockFetch();

export const EditWeekday = () => (
  <div className="card" style={{ maxWidth: 640 }}>
    <ProgramEditor program={programs[0]} onSaved={() => {}} onClose={() => {}} />
  </div>
);
