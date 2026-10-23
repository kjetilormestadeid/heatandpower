import { ProgramsSection } from 'mill-dashboard';
import { installMockFetch, programs, rooms } from './_mock';

installMockFetch();

export const Overview = () => (
  <div style={{ maxWidth: 760 }}>
    <ProgramsSection houseId="house-1" programs={programs} rooms={rooms} onChanged={() => {}} />
  </div>
);
