import { Injectable, Logger } from '@nestjs/common';
import { CrawlerLog } from './entities/crawler-log.entity';

/**
 * 线上环境空壳 CrawlerService（不含 puppeteer 依赖）
 * 当 CRAWLER_ENABLED=false 时注入此实现
 */
@Injectable()
export class CrawlerServiceStub {
  private readonly logger = new Logger(CrawlerServiceStub.name);

  private disabled() {
    return { success: false, message: '爬虫功能在当前环境未启用（CRAWLER_ENABLED=false）' };
  }

  async crawlFlights(): Promise<{ success: boolean; count: number }> {
    this.logger.warn('爬虫未启用，跳过 crawlFlights');
    return { success: false, count: 0 };
  }

  async debugFlightByDate(): Promise<{ success: boolean; message: string; flights?: unknown[] }> {
    return { ...this.disabled(), flights: [] };
  }

  async forceStop(): Promise<{ stopped: boolean; taskId: number | null; message: string }> {
    return { stopped: false, taskId: null, message: this.disabled().message };
  }

  async initializeDiscoverAirports(): Promise<{
    success: boolean;
    message: string;
    airportCount: number;
    flightCount: number;
    taskId?: number;
    executionPlan?: { totalTasks: number; estimatedTime: string; [key: string]: unknown };
  }> {
    return { ...this.disabled(), airportCount: 0, flightCount: 0 };
  }

  async initializeRefreshFlightsByDateRange(): Promise<{
    success: boolean;
    message: string;
    taskId?: number;
    executionPlan?: { totalTasks: number; estimatedTime: string; [key: string]: unknown };
    executionResult?: { successTasks: number; failedTasks: number; totalCount: number; [key: string]: unknown };
  }> {
    return { ...this.disabled() };
  }

  async triggerCrawl(): Promise<{ success: boolean; count: number }> {
    return { success: false, count: 0 };
  }

  async scheduledCrawl(): Promise<void> {
    this.logger.warn('爬虫未启用，跳过定时任务');
  }

  async queryLogs(
    _taskType?: string,
    _status?: string,
    _page = 1,
    _pageSize = 20,
  ): Promise<{ data: CrawlerLog[]; total: number; page: number; pageSize: number }> {
    return { data: [], total: 0, page: _page, pageSize: _pageSize };
  }

  async getSubLogs(_parentId: number): Promise<CrawlerLog[]> {
    return [];
  }

  async getLogDetail(_id: number): Promise<CrawlerLog | null> {
    return null;
  }

  async getLogStats(): Promise<{
    total: number;
    running: number;
    success: number;
    failed: number;
    byType: Record<string, number>;
  }> {
    return { total: 0, running: 0, success: 0, failed: 0, byType: {} };
  }

  async cleanOldLogs(_days = 90): Promise<{ deletedCount: number }> {
    return { deletedCount: 0 };
  }

  async cleanAllLogs(): Promise<{ deletedCount: number }> {
    return { deletedCount: 0 };
  }
}
