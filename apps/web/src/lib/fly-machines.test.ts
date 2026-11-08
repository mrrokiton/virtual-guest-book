import { describe, expect, it } from 'vitest';
import { machinesToStart, type FlyMachineSnapshot } from './fly-machines';

const machine = (patch: Partial<FlyMachineSnapshot>): FlyMachineSnapshot => ({
  id: 'primary',
  state: 'stopped',
  ...patch,
});

describe('machinesToStart', () => {
  it('starts a stopped primary and leaves its standby stopped', () => {
    const ids = machinesToStart([
      machine({ id: 'primary', state: 'stopped' }),
      machine({ id: 'standby', state: 'stopped', config: { standbys: ['primary'] } }),
    ]);
    expect(ids).toEqual(['primary']);
  });

  it('does nothing while the primary is already running', () => {
    expect(machinesToStart([machine({ state: 'started' })])).toEqual([]);
  });

  it('starts a suspended or freshly created primary', () => {
    expect(
      machinesToStart([
        machine({ id: 'a', state: 'suspended' }),
        machine({ id: 'b', state: 'created' }),
        machine({ id: 'c', state: 'stopping' }),
      ]),
    ).toEqual(['a', 'b']);
  });
});
