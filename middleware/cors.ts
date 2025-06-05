import { NextApiRequest, NextApiResponse } from 'next';

type NextApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void;

/**
 * CORS middleware for Next.js API routes
 * This middleware enables cross-origin requests for API endpoints
 */
export const corsMiddleware = (handler: NextApiHandler) => async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // Define allowed origins (use environment variable in production)
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['*'];
    
  // Get the request origin
  const origin = req.headers.origin || '';
  
  // Set CORS headers
  // Allow specific origins or any origin during development
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  // Allow credentials (cookies, authorization headers)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Allow common HTTP methods
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  
  // Allow common headers
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Content-Type, Accept, Authorization'
  );

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Call the actual API handler
  return handler(req, res);
};

/**
 * Utility function to apply multiple middleware functions to an API route
 */
export const applyMiddleware = (handler: NextApiHandler, middlewares: ((handler: NextApiHandler) => NextApiHandler)[]) => {
  return middlewares.reduceRight((nextHandler, middleware) => {
    return middleware(nextHandler);
  }, handler);
};

// Example usage:
// export default applyMiddleware(handler, [corsMiddleware, authMiddleware]);
