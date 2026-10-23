import { TibberSection } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const PricesAndUsage = () => <div style={{ maxWidth: 760 }}><TibberSection /></div>;
