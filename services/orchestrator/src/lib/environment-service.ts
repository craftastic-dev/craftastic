import { getDatabase } from './kysely';
import { Environment } from '../routes/environments';

export class EnvironmentService {
  private db = getDatabase();

  async getUserEnvironments(userId: string): Promise<Environment[]> {
    const environments = await this.db
      .selectFrom('environments')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();

    return environments.map(env => ({
      id: env.id,
      userId: env.user_id,
      name: env.name,
      repositoryUrl: env.repository_url,
      branch: env.branch,
      containerId: env.container_id,
      status: env.status,
      createdAt: env.created_at.toISOString(),
      updatedAt: env.updated_at.toISOString(),
    }));
  }

  async createEnvironment(
    userId: string, 
    name: string, 
    repositoryUrl?: string, 
    branch: string = 'main'
  ): Promise<Environment> {
    const environment = await this.db
      .insertInto('environments')
      .values({
        user_id: userId,
        name,
        repository_url: repositoryUrl,
        branch,
        status: 'starting',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: environment.id,
      userId: environment.user_id,
      name: environment.name,
      repositoryUrl: environment.repository_url,
      branch: environment.branch,
      containerId: environment.container_id,
      status: environment.status,
      createdAt: environment.created_at.toISOString(),
      updatedAt: environment.updated_at.toISOString(),
    };
  }

  async updateEnvironmentContainer(environmentId: string, containerId: string, status: 'running' | 'stopped' | 'starting' | 'error'): Promise<void> {
    await this.db
      .updateTable('environments')
      .set({
        container_id: containerId,
        status,
        updated_at: new Date(),
      })
      .where('id', '=', environmentId)
      .execute();
  }

  async getEnvironmentById(environmentId: string): Promise<Environment | null> {
    const environment = await this.db
      .selectFrom('environments')
      .selectAll()
      .where('id', '=', environmentId)
      .executeTakeFirst();

    if (!environment) return null;

    return {
      id: environment.id,
      userId: environment.user_id,
      name: environment.name,
      repositoryUrl: environment.repository_url,
      branch: environment.branch,
      containerId: environment.container_id,
      status: environment.status,
      createdAt: environment.created_at.toISOString(),
      updatedAt: environment.updated_at.toISOString(),
    };
  }

  async deleteEnvironment(environmentId: string): Promise<void> {
    await this.db
      .deleteFrom('environments')
      .where('id', '=', environmentId)
      .execute();
  }
}