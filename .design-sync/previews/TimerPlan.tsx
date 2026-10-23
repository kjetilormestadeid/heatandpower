import { TimerPlan } from 'mill-dashboard';
import { devices, installMockFetch } from './_mock';

installMockFetch();
const independent = devices.find((d) => d.deviceId === 'dev-3')!;
const inRoom = devices.find((d) => d.deviceId === 'dev-1')!;

export const Schedule = () => (
  <div className="card" style={{ maxWidth: 420 }}><TimerPlan device={independent} onMoved={() => {}} /></div>
);

export const DeviceInRoom = () => (
  <div className="card" style={{ maxWidth: 420 }}><TimerPlan device={inRoom} onMoved={() => {}} /></div>
);
