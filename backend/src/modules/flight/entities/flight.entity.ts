import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('flights')
@Index(['origin', 'destination', 'departureTime'])
@Index(['crawledAt'])
@Index(['has666Card'])
@Index(['has2666Card'])
@Index(['flightNo', 'origin', 'destination', 'departureTime', 'cardType'], { unique: true })
export class Flight {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  flightNo: string;

  @Column()
  origin: string;

  @Column()
  destination: string;

  @Column({ type: 'datetime' })
  departureTime: Date;

  @Column({ type: 'datetime' })
  arrivalTime: Date;

  @Column({ nullable: true })
  availableSeats: number;

  @Column({ nullable: true })
  aircraftType: string;

  @Column({ default: '全部' })
  cardType: string; // 666权益卡/2666权益卡/全部（保留用于展示，过滤请用下方两个布尔字段）

  @Column({ default: false })
  has666Card: boolean; // 是否支持 666 权益卡兑换

  @Column({ default: false })
  has2666Card: boolean; // 是否支持 2666 权益卡兑换

  @Column({ type: 'datetime' })
  crawledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
