import '@fastify/jwt'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string; // user ID  
      email: string;
      name: string;
      emailVerified: boolean;
    }
    user: {
      sub: string; // user ID
      email: string;
      name: string;
      emailVerified: boolean;
    }
  }
}