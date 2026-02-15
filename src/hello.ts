import { createMachine } from 'xstate';

const helloMachine = createMachine({
  id: 'hello',
  initial: 'idle',
  states: {
    idle: {},
  },
});

console.log(helloMachine.id);
