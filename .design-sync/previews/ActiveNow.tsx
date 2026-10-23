import { ActiveNow } from 'mill-dashboard';
import { installMockFetch, rooms } from './_mock';

installMockFetch();

export const InDashboard = () => <div style={{ maxWidth: 640 }}><ActiveNow houseId="house-1" rooms={rooms} /></div>;
