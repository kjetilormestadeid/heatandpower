import { EnergyChart } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const ThisMonth = () => <div style={{ maxWidth: 760 }}><EnergyChart houseId="house-1" /></div>;
