import { RoomCard } from 'mill-dashboard';
import { installMockFetch, programs, rooms } from './_mock';

installMockFetch();
const noop = () => {};

export const Heating = () => (
  <div style={{ maxWidth: 360 }}><RoomCard room={rooms[0]} programs={programs} onChanged={noop} /></div>
);

export const Overridden = () => (
  <div style={{ maxWidth: 360 }}><RoomCard room={rooms[2]} programs={programs} onChanged={noop} /></div>
);

export const Offline = () => (
  <div style={{ maxWidth: 360 }}><RoomCard room={rooms[3]} programs={programs} onChanged={noop} /></div>
);
