import { HueSection } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const Connected = () => <div style={{ maxWidth: 760 }}><HueSection /></div>;
