import { Login } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const SignIn = () => <Login onLogin={() => {}} />;
