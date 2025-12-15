const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config/env');
const logger = require('../utils/logger');

class SupabaseService {
  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.key);
  }

  /**
   * Получить всех пользователей с информацией об отделах
   */
  async getUsers() {
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select(`
          user_id,
          email,
          first_name,
          last_name,
          department_id,
          team_id,
          position_id,
          category_id,
          salary,
          departments!profiles_department_membership_fkey (
            department_id,
            department_name
          ),
          teams!profiles_team_membership_fkey (
            team_id,
            team_name
          )
        `);

      if (error) throw error;

      // Получаем должности и категории для обогащения данных
      const [positions, categories] = await Promise.all([
        this.getPositions(),
        this.getCategories()
      ]);

      // Создаем lookup maps
      const positionMap = new Map(positions.map(p => [p.position_id, p.position_name]));
      const categoryMap = new Map(categories.map(c => [c.category_id, c.category_name]));

      // Преобразуем в удобный формат с обогащением данных
      const users = (data || []).map(user => ({
        user_id: user.user_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        department_id: user.department_id,
        team_id: user.team_id,
        position_id: user.position_id,
        category_id: user.category_id,
        salary: user.salary,
        department_name: user.departments?.department_name || null,
        team_name: user.teams?.team_name || null,
        position_name: positionMap.get(user.position_id) || null,
        category_name: categoryMap.get(user.category_id) || null
      }));

      logger.success(`✅ Получено ${users.length} пользователей из Supabase`);
      return users;

    } catch (error) {
      logger.error(`Error getting users: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получить все отделы
   */
  async getDepartments() {
    try {
      const { data, error } = await this.client
        .from('departments')
        .select('department_id, department_name');

      if (error) throw error;

      logger.info(`📋 Получено ${data?.length || 0} отделов из Supabase`);
      return data || [];
    } catch (error) {
      logger.error(`Error getting departments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получить все команды
   */
  async getTeams() {
    try {
      const { data, error } = await this.client
        .from('teams')
        .select('team_id, team_name');

      if (error) throw error;

      logger.info(`👥 Получено ${data?.length || 0} команд из Supabase`);
      return data || [];
    } catch (error) {
      logger.error(`Error getting teams: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получить все должности
   */
  async getPositions() {
    try {
      const { data, error } = await this.client
        .from('positions')
        .select('position_id, position_name');

      if (error) throw error;

      logger.debug(`📊 Получено ${data?.length || 0} должностей из Supabase`);
      return data || [];
    } catch (error) {
      logger.error(`Error getting positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получить все категории
   */
  async getCategories() {
    try {
      const { data, error } = await this.client
        .from('categories')
        .select('category_id, category_name');

      if (error) throw error;

      logger.debug(`📊 Получено ${data?.length || 0} категорий из Supabase`);
      return data || [];
    } catch (error) {
      logger.error(`Error getting categories: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new SupabaseService();
