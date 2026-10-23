import { Dashboard } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const FullPage = () => <Dashboard user="kari@example.no" onLogout={() => {}} />;
