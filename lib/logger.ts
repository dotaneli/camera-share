import { logger, consoleTransport } from 'react-native-logs';

const log = logger.createLogger({
  severity: __DEV__ ? 'debug' : 'info',
  transport: consoleTransport,
  transportOptions: {
    colors: {
      debug: 'white' as const,
      info: 'blueBright' as const,
      warn: 'yellowBright' as const,
      error: 'redBright' as const,
    },
  },
  levels: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  },
});

export default log;
