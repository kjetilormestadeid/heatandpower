import { CompareView } from 'mill-dashboard';
import { millStats, tibberDaily } from './_mock';
import { mergeDays } from '../../src/components/ConsumptionCompare';

const days = mergeDays(tibberDaily(), millStats().energyUsage.items);

export const Last30Days = () => <CompareView days={days} />;

export const OneWeek = () => <CompareView days={days.slice(-7)} />;
