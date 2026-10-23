import { ConsumptionCompare } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const InDashboard = () => <ConsumptionCompare houseId="house-1" />;
