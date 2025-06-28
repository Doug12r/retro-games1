import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface MetadataSearchRequest {
  title: string;
  platform: string;
  region?: string;
  fileHash?: string;
  year?: number;
}

export interface GameMetadata {
  title: string;
  alternativeTitles?: string[];
  developer?: string;
  publisher?: string;
  releaseDate?: Date;
  releaseYear?: number;
  genre?: string;
  subGenre?: string;
  region?: string;
  language?: string;
  players?: number;
  rating?: number;
  description?: string;
  boxArtUrl?: string;
  screenshotUrls?: string[];
  videoUrl?: string;
  igdbId?: string;
  thegamesdbId?: string;
  screenscrapeId?: string;
  confidence?: number;
}

export interface ScrapingSource {
  name: string;
  priority: number;
  enabled: boolean;
  search: (request: MetadataSearchRequest) => Promise<GameMetadata[]>;
}

export class MetadataScrapingService {
  private httpClient: AxiosInstance;
  private sources: ScrapingSource[] = [];
  private cache: Map<string, GameMetadata> = new Map();

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'RetroGame-Backend/1.0.0',
      },
    });

    this.initializeSources();
  }

  /**
   * Initialize metadata sources
   */
  private initializeSources() {
    // IGDB (Internet Game Database)
    if (config.apis.igdb.clientId && config.apis.igdb.clientSecret) {
      this.sources.push({
        name: 'IGDB',
        priority: 1,
        enabled: true,
        search: this.searchIGDB.bind(this),
      });
    }

    // TheGamesDB
    if (config.apis.thegamesdb.apiKey) {
      this.sources.push({
        name: 'TheGamesDB',
        priority: 2,
        enabled: true,
        search: this.searchTheGamesDB.bind(this),
      });
    }

    // ScreenScraper
    if (config.apis.screenscraper.username && config.apis.screenscraper.password) {
      this.sources.push({
        name: 'ScreenScraper',
        priority: 3,
        enabled: true,
        search: this.searchScreenScraper.bind(this),
      });
    }

    // Local database fallback
    this.sources.push({
      name: 'Local',
      priority: 10,
      enabled: true,
      search: this.searchLocal.bind(this),
    });

    // Sort sources by priority
    this.sources.sort((a, b) => a.priority - b.priority);

    logger.info(`Initialized ${this.sources.length} metadata sources: ${this.sources.map(s => s.name).join(', ')}`);
  }

  /**
   * Scrape metadata from all available sources
   */
  async scrapeMetadata(request: MetadataSearchRequest): Promise<GameMetadata | null> {
    const cacheKey = this.getCacheKey(request);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      logger.debug(`Metadata cache hit for: ${request.title}`);
      return this.cache.get(cacheKey)!;
    }

    logger.info(`Scraping metadata for: ${request.title} (${request.platform})`);

    const results: GameMetadata[] = [];

    // Try each source in priority order
    for (const source of this.sources.filter(s => s.enabled)) {
      try {
        logger.debug(`Searching ${source.name} for: ${request.title}`);
        const sourceResults = await source.search(request);
        
        if (sourceResults.length > 0) {
          // Add source information to results
          sourceResults.forEach(result => {
            result.confidence = this.calculateConfidence(request, result, source.name);
          });
          
          results.push(...sourceResults);
          logger.info(`Found ${sourceResults.length} results from ${source.name}`);
        }
      } catch (error) {
        logger.warn(`Failed to search ${source.name}:`, error.message);
      }
    }

    if (results.length === 0) {
      logger.warn(`No metadata found for: ${request.title}`);
      return null;
    }

    // Merge and prioritize results
    const bestResult = this.mergeResults(results);
    
    // Cache the result
    this.cache.set(cacheKey, bestResult);
    
    logger.info(`Successfully scraped metadata for: ${bestResult.title}`);
    return bestResult;
  }

  /**
   * Search IGDB database
   */
  private async searchIGDB(request: MetadataSearchRequest): Promise<GameMetadata[]> {
    try {
      // Get access token first
      const tokenResponse = await this.httpClient.post(
        'https://id.twitch.tv/oauth2/token',
        new URLSearchParams({
          client_id: config.apis.igdb.clientId!,
          client_secret: config.apis.igdb.clientSecret!,
          grant_type: 'client_credentials',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Search for games
      const searchQuery = `
        search "${request.title}";
        fields name, alternative_names.name, platforms.name, genres.name, 
               first_release_date, summary, rating, cover.url, screenshots.url,
               involved_companies.company.name, involved_companies.developer,
               involved_companies.publisher;
        where platforms.name ~ "${this.mapPlatformToIGDB(request.platform)}";
        limit 10;
      `;

      const searchResponse = await this.httpClient.post(
        'https://api.igdb.com/v4/games',
        searchQuery,
        {
          headers: {
            'Client-ID': config.apis.igdb.clientId!,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'text/plain',
          },
        }
      );

      return this.parseIGDBResults(searchResponse.data);
    } catch (error) {
      logger.error('IGDB search failed:', error);
      throw error;
    }
  }

  /**
   * Search TheGamesDB
   */
  private async searchTheGamesDB(request: MetadataSearchRequest): Promise<GameMetadata[]> {
    try {
      const platformId = this.mapPlatformToTheGamesDB(request.platform);
      
      const response = await this.httpClient.get('https://api.thegamesdb.net/v1/Games/ByGameName', {
        params: {
          apikey: config.apis.thegamesdb.apiKey,
          name: request.title,
          platform: platformId,
        },
      });

      return this.parseTheGamesDBResults(response.data);
    } catch (error) {
      logger.error('TheGamesDB search failed:', error);
      throw error;
    }
  }

  /**
   * Search ScreenScraper
   */
  private async searchScreenScraper(request: MetadataSearchRequest): Promise<GameMetadata[]> {
    try {
      const systemId = this.mapPlatformToScreenScraper(request.platform);
      
      const response = await this.httpClient.get('https://www.screenscraper.fr/api2/jeuInfos.php', {
        params: {
          devid: 'retrogame',
          devpassword: 'retrogame',
          softname: 'retrogame-backend/1.0.0',
          output: 'json',
          ssid: config.apis.screenscraper.username,
          sspassword: config.apis.screenscraper.password,
          systemeid: systemId,
          romnom: request.title,
        },
      });

      return this.parseScreenScraperResults(response.data);
    } catch (error) {
      logger.error('ScreenScraper search failed:', error);
      throw error;
    }
  }

  /**
   * Search local database
   */
  private async searchLocal(request: MetadataSearchRequest): Promise<GameMetadata[]> {
    // This would search a local database of game metadata
    // For now, return basic metadata based on filename
    return [{
      title: this.cleanTitle(request.title),
      platform: request.platform,
      region: request.region,
      confidence: 0.3, // Low confidence for local fallback
    }];
  }

  /**
   * Parse IGDB API results
   */
  private parseIGDBResults(data: any[]): GameMetadata[] {
    return data.map(game => ({
      title: game.name,
      alternativeTitles: game.alternative_names?.map((alt: any) => alt.name) || [],
      developer: game.involved_companies?.find((c: any) => c.developer)?.company?.name,
      publisher: game.involved_companies?.find((c: any) => c.publisher)?.company?.name,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000) : undefined,
      releaseYear: game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : undefined,
      genre: game.genres?.[0]?.name,
      rating: game.rating ? game.rating / 10 : undefined, // Convert to 0-10 scale
      description: game.summary,
      boxArtUrl: game.cover?.url ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
      screenshotUrls: game.screenshots?.map((s: any) => `https:${s.url.replace('t_thumb', 't_screenshot_big')}`) || [],
      igdbId: game.id?.toString(),
    }));
  }

  /**
   * Parse TheGamesDB API results
   */
  private parseTheGamesDBResults(data: any): GameMetadata[] {
    if (!data.data?.games) return [];

    return Object.values(data.data.games as any[]).map((game: any) => ({
      title: game.game_title,
      developer: game.developers?.[0],
      publisher: game.publishers?.[0],
      releaseDate: game.release_date ? new Date(game.release_date) : undefined,
      releaseYear: game.release_date ? new Date(game.release_date).getFullYear() : undefined,
      genre: game.genres?.[0],
      rating: game.rating ? parseFloat(game.rating) : undefined,
      description: game.overview,
      boxArtUrl: this.buildTheGamesDBImageUrl(game.id, data.include?.boxart),
      screenshotUrls: this.buildTheGamesDBScreenshots(game.id, data.include?.screenshots) || [],
      thegamesdbId: game.id?.toString(),
    }));
  }

  /**
   * Parse ScreenScraper API results
   */
  private parseScreenScraperResults(data: any): GameMetadata[] {
    if (!data.response?.jeu) return [];

    const game = data.response.jeu;
    return [{
      title: game.noms?.nom_eu || game.noms?.nom_us || game.noms?.nom_jp,
      alternativeTitles: Object.values(game.noms || {}).filter((name: any) => typeof name === 'string'),
      developer: game.developpeur?.text,
      publisher: game.editeur?.text,
      releaseDate: game.dates?.monde ? new Date(game.dates.monde) : undefined,
      releaseYear: game.dates?.monde ? new Date(game.dates.monde).getFullYear() : undefined,
      genre: game.genres?.genre?.[0]?.noms?.nom_eu,
      rating: game.note ? parseFloat(game.note) / 2 : undefined, // Convert from 0-20 to 0-10
      description: game.synopsis?.synopsis_eu || game.synopsis?.synopsis_us,
      boxArtUrl: game.medias?.media_boxs2d?.[0]?.url,
      screenshotUrls: game.medias?.media_screenshots?.map((s: any) => s.url) || [],
      screenscrapeId: game.id?.toString(),
    }];
  }

  /**
   * Calculate confidence score for search result
   */
  private calculateConfidence(request: MetadataSearchRequest, result: GameMetadata, source: string): number {
    let confidence = 0.5; // Base confidence

    // Exact title match
    if (result.title.toLowerCase() === request.title.toLowerCase()) {
      confidence += 0.3;
    } else if (result.title.toLowerCase().includes(request.title.toLowerCase()) ||
               request.title.toLowerCase().includes(result.title.toLowerCase())) {
      confidence += 0.2;
    }

    // Alternative title matches
    if (result.alternativeTitles?.some(alt => 
      alt.toLowerCase() === request.title.toLowerCase()
    )) {
      confidence += 0.25;
    }

    // Year match
    if (request.year && result.releaseYear && Math.abs(result.releaseYear - request.year) <= 1) {
      confidence += 0.15;
    }

    // Source priority
    switch (source) {
      case 'IGDB': confidence += 0.1; break;
      case 'TheGamesDB': confidence += 0.08; break;
      case 'ScreenScraper': confidence += 0.06; break;
      default: confidence += 0.0; break;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Merge results from multiple sources
   */
  private mergeResults(results: GameMetadata[]): GameMetadata {
    // Sort by confidence
    results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    
    const bestResult = results[0];
    
    // Merge additional data from other sources
    for (let i = 1; i < results.length; i++) {
      const result = results[i];
      
      // Fill in missing fields
      if (!bestResult.developer && result.developer) bestResult.developer = result.developer;
      if (!bestResult.publisher && result.publisher) bestResult.publisher = result.publisher;
      if (!bestResult.genre && result.genre) bestResult.genre = result.genre;
      if (!bestResult.rating && result.rating) bestResult.rating = result.rating;
      if (!bestResult.description && result.description) bestResult.description = result.description;
      if (!bestResult.boxArtUrl && result.boxArtUrl) bestResult.boxArtUrl = result.boxArtUrl;
      
      // Merge screenshot URLs
      if (result.screenshotUrls && result.screenshotUrls.length > 0) {
        bestResult.screenshotUrls = [
          ...(bestResult.screenshotUrls || []),
          ...result.screenshotUrls,
        ].slice(0, 10); // Limit to 10 screenshots
      }
    }

    return bestResult;
  }

  /**
   * Platform mapping utilities
   */
  private mapPlatformToIGDB(platform: string): string {
    const mapping: Record<string, string> = {
      'nes': 'Nintendo Entertainment System',
      'snes': 'Super Nintendo Entertainment System',
      'n64': 'Nintendo 64',
      'gameboy': 'Game Boy',
      'gbc': 'Game Boy Color',
      'gba': 'Game Boy Advance',
      'genesis': 'Sega Mega Drive/Genesis',
      'mastersystem': 'Sega Master System',
      'psx': 'PlayStation',
      'ps2': 'PlayStation 2',
    };
    return mapping[platform] || platform;
  }

  private mapPlatformToTheGamesDB(platform: string): string {
    const mapping: Record<string, string> = {
      'nes': '7',
      'snes': '6',
      'n64': '3',
      'gameboy': '4',
      'gbc': '41',
      'gba': '5',
      'genesis': '18',
      'mastersystem': '35',
      'psx': '10',
      'ps2': '11',
    };
    return mapping[platform] || '0';
  }

  private mapPlatformToScreenScraper(platform: string): string {
    const mapping: Record<string, string> = {
      'nes': '3',
      'snes': '4',
      'n64': '14',
      'gameboy': '9',
      'gbc': '10',
      'gba': '12',
      'genesis': '1',
      'mastersystem': '2',
      'psx': '57',
      'ps2': '58',
    };
    return mapping[platform] || '0';
  }

  /**
   * Utility functions
   */
  private getCacheKey(request: MetadataSearchRequest): string {
    return `${request.platform}:${request.title.toLowerCase()}`;
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/\.[^/.]+$/, '') // Remove file extension
      .replace(/[\[\(].*?[\]\)]/g, '') // Remove content in brackets/parentheses
      .replace(/[_-]/g, ' ') // Replace underscores and dashes with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }

  private buildTheGamesDBImageUrl(gameId: string, boxart: any): string | undefined {
    if (!boxart || !gameId) return undefined;
    
    const gameBoxart = Object.values(boxart).find((art: any) => art.id === gameId);
    return gameBoxart ? `https://cdn.thegamesdb.net/images/thumb/${gameBoxart.filename}` : undefined;
  }

  private buildTheGamesDBScreenshots(gameId: string, screenshots: any): string[] {
    if (!screenshots || !gameId) return [];
    
    return Object.values(screenshots)
      .filter((shot: any) => shot.id === gameId)
      .map((shot: any) => `https://cdn.thegamesdb.net/images/thumb/${shot.filename}`);
  }

  /**
   * Clear cache
   */
  public clearCache(): void {
    this.cache.clear();
    logger.info('Metadata cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; sources: string[] } {
    return {
      size: this.cache.size,
      sources: this.sources.filter(s => s.enabled).map(s => s.name),
    };
  }
}

export default MetadataScrapingService;