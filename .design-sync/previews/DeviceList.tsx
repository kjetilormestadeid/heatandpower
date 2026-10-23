import { DeviceList } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

export const InRoom = () => (
  <div className="card" style={{ maxWidth: 360 }}><DeviceList source={{ roomId: 'room-stue' }} /></div>
);

export const WithoutRoom = () => (
  <div className="card" style={{ maxWidth: 360 }}><DeviceList source={{ houseId: 'house-1' }} /></div>
);
