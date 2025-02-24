import winston from 'winston';

export const logger = winston.createLogger({
    level: 'info', // Log level (e.g., 'error', 'warn', 'info', 'debug')
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console(), // Log to console
      new winston.transports.File({ filename: 'gemini-interactions.log' }) // Log to file
    ]
});

