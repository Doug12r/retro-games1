-- ============================================================================
-- RETRO GAME SERVER DATABASE INITIALIZATION SCRIPT
-- Comprehensive schema setup for production deployment
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Create custom types
CREATE TYPE platform_type AS ENUM (
    'nintendo_nes', 'nintendo_snes', 'nintendo_n64', 'nintendo_gameboy', 
    'nintendo_gba', 'nintendo_nds', 'nintendo_switch',
    'sega_genesis', 'sega_mastersystem', 'sega_saturn', 'sega_dreamcast', 'sega_gamegear',
    'sony_psx', 'sony_ps2', 'sony_ps3', 'sony_psp', 'sony_psvita',
    'arcade_mame', 'arcade_neogeo', 'arcade_cps1', 'arcade_cps2', 'arcade_cps3',
    'computer_dos', 'computer_amiga', 'computer_c64', 'computer_atari2600', 
    'computer_atari7800', 'computer_atarist',
    'handheld_wonderswan', 'handheld_ngp', 'handheld_lynx'
);

CREATE TYPE upload_status AS ENUM (
    'pending', 'uploading', 'processing', 'completed', 'failed', 'cancelled'
);

CREATE TYPE game_region AS ENUM (
    'NTSC', 'PAL', 'NTSC-J', 'NTSC-U', 'PAL-A', 'PAL-E', 'WORLD', 'UNKNOWN'
);

CREATE TYPE user_role AS ENUM (
    'admin', 'moderator', 'user', 'guest'
);

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login TIMESTAMPTZ,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platforms table
CREATE TABLE IF NOT EXISTS platforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type platform_type NOT NULL,
    short_name VARCHAR(20) NOT NULL,
    manufacturer VARCHAR(100),
    release_year INTEGER,
    description TEXT,
    icon_url VARCHAR(255),
    supported_formats TEXT[] DEFAULT '{}',
    retroarch_cores TEXT[] DEFAULT '{}',
    bios_required BOOLEAN DEFAULT false,
    bios_files TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(type)
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(64) UNIQUE NOT NULL,
    region game_region DEFAULT 'UNKNOWN',
    language VARCHAR(10),
    version VARCHAR(50),
    rom_type VARCHAR(20), -- ROM, ISO, BIN, etc.
    
    -- Metadata
    description TEXT,
    genre VARCHAR(100),
    developer VARCHAR(100),
    publisher VARCHAR(100),
    release_date DATE,
    rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 10),
    players_min INTEGER DEFAULT 1,
    players_max INTEGER DEFAULT 1,
    
    -- Media
    cover_image_url VARCHAR(255),
    screenshot_urls TEXT[] DEFAULT '{}',
    video_url VARCHAR(255),
    
    -- Flags
    is_verified BOOLEAN DEFAULT false,
    is_favorite BOOLEAN DEFAULT false,
    is_hidden BOOLEAN DEFAULT false,
    
    -- Stats
    download_count INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    last_played TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Indexes for performance
    CONSTRAINT unique_game_per_platform UNIQUE(platform_id, file_hash)
);

-- Upload sessions table
CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    platform_id UUID REFERENCES platforms(id),
    
    -- Upload progress
    status upload_status DEFAULT 'pending',
    bytes_uploaded BIGINT DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    
    -- Processing info
    chunks_total INTEGER DEFAULT 0,
    chunks_received INTEGER DEFAULT 0,
    temp_file_path VARCHAR(500),
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Metadata extraction
    extracted_metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Save states table
CREATE TABLE IF NOT EXISTS save_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Save state info
    slot_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    save_data BYTEA NOT NULL,
    screenshot BYTEA,
    
    -- Metadata
    game_time INTEGER, -- playtime in seconds
    level_name VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique save slots per user/game
    UNIQUE(game_id, user_id, slot_number)
);

-- Game collections table
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    cover_image_url VARCHAR(255),
    game_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, name)
);

-- Collection games junction table
CREATE TABLE IF NOT EXISTS collection_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(collection_id, game_id)
);

-- Game reviews table
CREATE TABLE IF NOT EXISTS game_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_recommended BOOLEAN DEFAULT true,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(game_id, user_id)
);

-- Download history table
CREATE TABLE IF NOT EXISTS download_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    download_size BIGINT,
    download_duration INTEGER, -- seconds
    completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level VARCHAR(20) NOT NULL, -- DEBUG, INFO, WARN, ERROR
    component VARCHAR(50) NOT NULL, -- api, uploader, processor, etc.
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Application settings table
CREATE TABLE IF NOT EXISTS app_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false, -- whether setting can be read by non-admin users
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    permissions TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_used TIMESTAMPTZ,
    usage_count INTEGER DEFAULT 0,
    rate_limit INTEGER DEFAULT 1000, -- requests per hour
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(key_hash)
);

-- Background jobs table
CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL, -- metadata_scraping, file_processing, etc.
    status VARCHAR(20) DEFAULT 'pending', -- pending, running, completed, failed
    payload JSONB NOT NULL DEFAULT '{}',
    result JSONB DEFAULT '{}',
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    priority INTEGER DEFAULT 0,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Games indexes
CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games(platform_id);
CREATE INDEX IF NOT EXISTS idx_games_title ON games(title);
CREATE INDEX IF NOT EXISTS idx_games_file_hash ON games(file_hash);
CREATE INDEX IF NOT EXISTS idx_games_region ON games(region);
CREATE INDEX IF NOT EXISTS idx_games_genre ON games(genre);
CREATE INDEX IF NOT EXISTS idx_games_release_date ON games(release_date);
CREATE INDEX IF NOT EXISTS idx_games_rating ON games(rating);
CREATE INDEX IF NOT EXISTS idx_games_verified ON games(is_verified);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at);

-- Full-text search index for games
CREATE INDEX IF NOT EXISTS idx_games_search ON games USING gin(
    to_tsvector('english', title || ' ' || COALESCE(description, '') || ' ' || COALESCE(developer, '') || ' ' || COALESCE(publisher, ''))
);

-- Upload sessions indexes
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_id ON upload_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_created_at ON upload_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);

-- Save states indexes
CREATE INDEX IF NOT EXISTS idx_save_states_game_user ON save_states(game_id, user_id);
CREATE INDEX IF NOT EXISTS idx_save_states_created_at ON save_states(created_at);

-- Collections indexes
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_public ON collections(is_public);
CREATE INDEX IF NOT EXISTS idx_collection_games_collection_id ON collection_games(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_games_game_id ON collection_games(game_id);

-- Reviews indexes
CREATE INDEX IF NOT EXISTS idx_game_reviews_game_id ON game_reviews(game_id);
CREATE INDEX IF NOT EXISTS idx_game_reviews_user_id ON game_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_game_reviews_rating ON game_reviews(rating);

-- System logs indexes
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_component ON system_logs(component);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON system_logs(user_id);

-- Background jobs indexes
CREATE INDEX IF NOT EXISTS idx_background_jobs_type ON background_jobs(type);
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_priority ON background_jobs(priority);
CREATE INDEX IF NOT EXISTS idx_background_jobs_scheduled_at ON background_jobs(scheduled_at);

-- ============================================================================
-- TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platforms_updated_at BEFORE UPDATE ON platforms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_upload_sessions_updated_at BEFORE UPDATE ON upload_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_save_states_updated_at BEFORE UPDATE ON save_states
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_game_reviews_updated_at BEFORE UPDATE ON game_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update collection game count
CREATE OR REPLACE FUNCTION update_collection_game_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE collections 
        SET game_count = game_count + 1 
        WHERE id = NEW.collection_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE collections 
        SET game_count = game_count - 1 
        WHERE id = OLD.collection_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Apply collection count triggers
CREATE TRIGGER update_collection_count_on_insert 
    AFTER INSERT ON collection_games
    FOR EACH ROW EXECUTE FUNCTION update_collection_game_count();

CREATE TRIGGER update_collection_count_on_delete 
    AFTER DELETE ON collection_games
    FOR EACH ROW EXECUTE FUNCTION update_collection_game_count();

-- Function to update game play count
CREATE OR REPLACE FUNCTION update_game_play_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE games 
    SET play_count = play_count + 1,
        last_played = NOW()
    WHERE id = NEW.game_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to update game download count
CREATE OR REPLACE FUNCTION update_game_download_count()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.completed = true AND (OLD.completed IS NULL OR OLD.completed = false) THEN
        UPDATE games 
        SET download_count = download_count + 1
        WHERE id = NEW.game_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply download count trigger
CREATE TRIGGER update_download_count 
    AFTER UPDATE ON download_history
    FOR EACH ROW EXECUTE FUNCTION update_game_download_count();

-- ============================================================================
-- INITIAL DATA SEEDING
-- ============================================================================

-- Insert default platforms
INSERT INTO platforms (name, type, short_name, manufacturer, release_year, supported_formats, retroarch_cores, bios_required, bios_files) VALUES
-- Nintendo platforms
('Nintendo Entertainment System', 'nintendo_nes', 'NES', 'Nintendo', 1985, ARRAY['nes', 'unif', 'nsf'], ARRAY['nestopia', 'fceumm', 'quicknes'], false, ARRAY[]::TEXT[]),
('Super Nintendo Entertainment System', 'nintendo_snes', 'SNES', 'Nintendo', 1990, ARRAY['sfc', 'smc', 'fig', 'swc'], ARRAY['snes9x', 'bsnes', 'bsnes_mercury'], false, ARRAY[]::TEXT[]),
('Nintendo 64', 'nintendo_n64', 'N64', 'Nintendo', 1996, ARRAY['z64', 'n64', 'v64'], ARRAY['mupen64plus', 'parallel_n64'], false, ARRAY[]::TEXT[]),
('Game Boy', 'nintendo_gameboy', 'GB', 'Nintendo', 1989, ARRAY['gb', 'gbc'], ARRAY['gambatte', 'sameboy', 'tgbdual'], false, ARRAY[]::TEXT[]),
('Game Boy Advance', 'nintendo_gba', 'GBA', 'Nintendo', 2001, ARRAY['gba', 'agb'], ARRAY['mgba', 'vba_next', 'gpsp'], false, ARRAY[]::TEXT[]),
('Nintendo DS', 'nintendo_nds', 'NDS', 'Nintendo', 2004, ARRAY['nds'], ARRAY['desmume', 'melonds'], false, ARRAY[]::TEXT[]),

-- Sega platforms
('Sega Genesis', 'sega_genesis', 'Genesis', 'Sega', 1988, ARRAY['md', 'gen', 'smd', 'bin'], ARRAY['genesis_plus_gx', 'picodrive'], false, ARRAY[]::TEXT[]),
('Sega Master System', 'sega_mastersystem', 'SMS', 'Sega', 1986, ARRAY['sms'], ARRAY['genesis_plus_gx', 'picodrive'], false, ARRAY[]::TEXT[]),
('Sega Saturn', 'sega_saturn', 'Saturn', 'Sega', 1994, ARRAY['cue', 'iso', 'mds'], ARRAY['kronos', 'yabasanshiro'], true, ARRAY['saturn_bios.bin']::TEXT[]),
('Sega Dreamcast', 'sega_dreamcast', 'Dreamcast', 'Sega', 1998, ARRAY['cdi', 'chd', 'gdi'], ARRAY['flycast', 'redream'], true, ARRAY['dc_boot.bin', 'dc_flash.bin']::TEXT[]),

-- Sony platforms
('Sony PlayStation', 'sony_psx', 'PSX', 'Sony', 1994, ARRAY['cue', 'bin', 'iso', 'pbp'], ARRAY['pcsx_rearmed', 'beetle_psx', 'swanstation'], true, ARRAY['scph1001.bin', 'scph5501.bin', 'scph7001.bin']::TEXT[]),
('Sony PlayStation 2', 'sony_ps2', 'PS2', 'Sony', 2000, ARRAY['iso', 'cso', 'bin'], ARRAY['pcsx2'], true, ARRAY['ps2_bios.bin']::TEXT[]),
('Sony PlayStation Portable', 'sony_psp', 'PSP', 'Sony', 2004, ARRAY['iso', 'cso', 'pbp'], ARRAY['ppsspp'], false, ARRAY[]::TEXT[]),

-- Arcade platforms
('MAME', 'arcade_mame', 'MAME', 'Various', 1975, ARRAY['zip'], ARRAY['mame2003_plus', 'mame2010', 'mame'], false, ARRAY[]::TEXT[]),
('Neo Geo', 'arcade_neogeo', 'Neo Geo', 'SNK', 1990, ARRAY['zip'], ARRAY['fbneo', 'fbalpha2012'], true, ARRAY['neogeo.zip']::TEXT[]),

-- Computer platforms
('MS-DOS', 'computer_dos', 'DOS', 'Microsoft', 1981, ARRAY['exe', 'com', 'bat', 'zip'], ARRAY['dosbox_pure', 'dosbox_core'], false, ARRAY[]::TEXT[]),
('Commodore 64', 'computer_c64', 'C64', 'Commodore', 1982, ARRAY['d64', 't64', 'prg'], ARRAY['vice_x64'], false, ARRAY[]::TEXT[]),
('Atari 2600', 'computer_atari2600', 'Atari2600', 'Atari', 1977, ARRAY['a26', 'bin'], ARRAY['stella2014', 'stella'], false, ARRAY[]::TEXT[])

ON CONFLICT (type) DO NOTHING;

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, role, email_verified) VALUES
('admin', 'admin@retrogame.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/VwqgHBZH6QY5/xYUO', 'admin', true)
ON CONFLICT (username) DO NOTHING;

-- Insert default application settings
INSERT INTO app_settings (key, value, description, is_public) VALUES
('app_name', '"RetroGame Server"', 'Application name', true),
('app_version', '"1.0.0"', 'Application version', true),
('max_upload_size', '4294967296', 'Maximum upload file size in bytes (4GB)', false),
('max_uploads_per_user', '100', 'Maximum concurrent uploads per user', false),
('enable_registration', 'true', 'Allow new user registration', true),
('enable_guest_access', 'false', 'Allow guest access without registration', true),
('default_language', '"en"', 'Default application language', true),
('maintenance_mode', 'false', 'Enable maintenance mode', true),
('enable_analytics', 'false', 'Enable usage analytics', false),
('session_timeout', '86400', 'Session timeout in seconds (24 hours)', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- CLEANUP AND MAINTENANCE FUNCTIONS
-- ============================================================================

-- Function to clean up expired upload sessions
CREATE OR REPLACE FUNCTION cleanup_expired_uploads()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM upload_sessions 
    WHERE expires_at < NOW() 
    AND status IN ('pending', 'failed', 'cancelled');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO system_logs (level, component, message, details)
    VALUES ('INFO', 'cleanup', 'Cleaned up expired upload sessions', 
            jsonb_build_object('deleted_count', deleted_count));
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old system logs
CREATE OR REPLACE FUNCTION cleanup_old_logs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM system_logs 
    WHERE created_at < NOW() - INTERVAL '1 day' * retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO system_logs (level, component, message, details)
    VALUES ('INFO', 'cleanup', 'Cleaned up old system logs', 
            jsonb_build_object('deleted_count', deleted_count, 'retention_days', retention_days));
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update game statistics
CREATE OR REPLACE FUNCTION update_game_statistics()
RETURNS VOID AS $$
BEGIN
    -- Update average ratings for games
    UPDATE games 
    SET rating = (
        SELECT AVG(rating)::DECIMAL(3,2) 
        FROM game_reviews 
        WHERE game_id = games.id
    )
    WHERE id IN (
        SELECT DISTINCT game_id FROM game_reviews
    );
    
    INSERT INTO system_logs (level, component, message)
    VALUES ('INFO', 'maintenance', 'Updated game statistics');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PERFORMANCE VIEWS
-- ============================================================================

-- View for game search with platform info
CREATE OR REPLACE VIEW games_with_platform AS
SELECT 
    g.*,
    p.name as platform_name,
    p.short_name as platform_short_name,
    p.manufacturer as platform_manufacturer,
    COALESCE(AVG(gr.rating), 0) as average_rating,
    COUNT(gr.id) as review_count
FROM games g
JOIN platforms p ON g.platform_id = p.id
LEFT JOIN game_reviews gr ON g.id = gr.game_id
GROUP BY g.id, p.id;

-- View for user statistics
CREATE OR REPLACE VIEW user_statistics AS
SELECT 
    u.id,
    u.username,
    u.role,
    COUNT(DISTINCT g.id) as games_uploaded,
    COUNT(DISTINCT ss.id) as save_states_count,
    COUNT(DISTINCT c.id) as collections_count,
    COUNT(DISTINCT gr.id) as reviews_count,
    u.created_at,
    u.last_login
FROM users u
LEFT JOIN games g ON g.id IN (
    SELECT game_id FROM upload_sessions us WHERE us.user_id = u.id AND us.status = 'completed'
)
LEFT JOIN save_states ss ON ss.user_id = u.id
LEFT JOIN collections c ON c.user_id = u.id
LEFT JOIN game_reviews gr ON gr.user_id = u.id
GROUP BY u.id;

-- View for platform statistics
CREATE OR REPLACE VIEW platform_statistics AS
SELECT 
    p.*,
    COUNT(g.id) as game_count,
    SUM(g.file_size) as total_size,
    AVG(g.rating) as average_rating,
    SUM(g.download_count) as total_downloads,
    SUM(g.play_count) as total_plays
FROM platforms p
LEFT JOIN games g ON g.platform_id = p.id
GROUP BY p.id;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

-- Log successful initialization
INSERT INTO system_logs (level, component, message, details) VALUES 
('INFO', 'database', 'Database schema initialized successfully', 
 jsonb_build_object(
     'tables_created', true,
     'indexes_created', true,
     'triggers_created', true,
     'initial_data_seeded', true,
     'version', '1.0.0'
 ));

-- Vacuum and analyze for optimal performance
VACUUM ANALYZE;

-- Success message
\echo 'Database initialization completed successfully!'
\echo 'Tables, indexes, triggers, and initial data have been created.'
\echo 'Default admin user: admin / admin123 (please change immediately)'