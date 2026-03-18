import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('query_cache')
export class QueryCache {
  @PrimaryColumn({ length: 512 })
  cacheKey: string;

  @Column({ type: 'text' })
  data: string; // JSON 序列化的缓存内容

  @Index()
  @Column({ type: 'datetime' })
  expireAt: Date;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
