<?php
/**
 * Plugin Name: Lynk CRM Connector
 * Description: Displays Lynk public catalog items and submits WordPress orders into Lynk website integrations.
 * Version: 0.1.0
 * Author: Lynk
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Lynk_CRM_Connector {
    private const OPTION_KEY = 'lynk_crm_connector_settings';
    private const NONCE_ACTION = 'lynk_crm_submit_order';

    public static function init(): void {
        add_action('admin_menu', [self::class, 'admin_menu']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_shortcode('lynk_catalog', [self::class, 'catalog_shortcode']);
        add_shortcode('lynk_order_form', [self::class, 'order_form_shortcode']);
        add_action('wp_enqueue_scripts', [self::class, 'enqueue_assets']);
        add_action('admin_post_nopriv_lynk_crm_submit_order', [self::class, 'handle_order_submit']);
        add_action('admin_post_lynk_crm_submit_order', [self::class, 'handle_order_submit']);
    }

    public static function enqueue_assets(): void {
        wp_enqueue_style('lynk-crm-connector', plugin_dir_url(__FILE__) . 'assets/lynk-crm.css', [], '0.1.0');
    }

    public static function admin_menu(): void {
        add_options_page(
            'Lynk CRM',
            'Lynk CRM',
            'manage_options',
            'lynk-crm-connector',
            [self::class, 'settings_page']
        );
    }

    public static function register_settings(): void {
        register_setting('lynk_crm_connector', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default' => self::default_settings(),
        ]);
    }

    public static function sanitize_settings(array $value): array {
        return [
            'api_base_url' => esc_url_raw(rtrim((string)($value['api_base_url'] ?? ''), '/')),
            'api_key' => sanitize_text_field((string)($value['api_key'] ?? '')),
            'catalog_limit' => max(1, min(100, absint($value['catalog_limit'] ?? 12))),
        ];
    }

    private static function default_settings(): array {
        return [
            'api_base_url' => '',
            'api_key' => '',
            'catalog_limit' => 12,
        ];
    }

    private static function settings(): array {
        return wp_parse_args(get_option(self::OPTION_KEY, []), self::default_settings());
    }

    public static function settings_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        $settings = self::settings();
        $test_result = null;
        if (isset($_POST['lynk_crm_test_connection']) && check_admin_referer('lynk_crm_test_connection')) {
            $response = self::request('GET', '/integrations/public/catalog?limit=1&offset=0');
            $test_result = is_wp_error($response)
                ? $response->get_error_message()
                : sprintf('Connected. HTTP %s', (string)wp_remote_retrieve_response_code($response));
        }
        ?>
        <div class="wrap">
            <h1>Lynk CRM Connector</h1>
            <?php if ($test_result): ?>
                <div class="notice notice-info"><p><?php echo esc_html($test_result); ?></p></div>
            <?php endif; ?>
            <form method="post" action="options.php">
                <?php settings_fields('lynk_crm_connector'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="lynk-api-base-url">Lynk API Base URL</label></th>
                        <td>
                            <input id="lynk-api-base-url" class="regular-text" name="<?php echo esc_attr(self::OPTION_KEY); ?>[api_base_url]" value="<?php echo esc_attr($settings['api_base_url']); ?>" placeholder="https://crm.example.com/api/v1" />
                            <p class="description">Use the API root, including <code>/api/v1</code>.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="lynk-api-key">Integration API Key</label></th>
                        <td>
                            <input id="lynk-api-key" class="regular-text" type="password" name="<?php echo esc_attr(self::OPTION_KEY); ?>[api_key]" value="<?php echo esc_attr($settings['api_key']); ?>" autocomplete="new-password" />
                            <p class="description">Create this in Lynk under Integrations with <code>catalog:read</code> and optionally <code>orders:write</code>.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="lynk-catalog-limit">Catalog Limit</label></th>
                        <td><input id="lynk-catalog-limit" type="number" min="1" max="100" name="<?php echo esc_attr(self::OPTION_KEY); ?>[catalog_limit]" value="<?php echo esc_attr((string)$settings['catalog_limit']); ?>" /></td>
                    </tr>
                </table>
                <?php submit_button('Save Settings'); ?>
            </form>
            <form method="post">
                <?php wp_nonce_field('lynk_crm_test_connection'); ?>
                <?php submit_button('Test Connection', 'secondary', 'lynk_crm_test_connection'); ?>
            </form>
            <h2>Shortcodes</h2>
            <p><code>[lynk_catalog]</code> renders public Lynk catalog items.</p>
            <p><code>[lynk_order_form slug="catalog-slug"]</code> renders a simple order form for one catalog item.</p>
        </div>
        <?php
    }

    private static function request(string $method, string $path, array $body = null) {
        $settings = self::settings();
        if (!$settings['api_base_url'] || !$settings['api_key']) {
            return new WP_Error('lynk_missing_settings', 'Lynk API URL and key are required.');
        }
        $args = [
            'method' => $method,
            'timeout' => 15,
            'headers' => [
                'Authorization' => 'Bearer ' . $settings['api_key'],
                'Content-Type' => 'application/json',
            ],
        ];
        if ($body !== null) {
            $args['body'] = wp_json_encode($body);
        }
        return wp_remote_request($settings['api_base_url'] . $path, $args);
    }

    private static function media_url(string $url): string {
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return $url;
        }
        $settings = self::settings();
        $parts = wp_parse_url($settings['api_base_url']);
        if (empty($parts['scheme']) || empty($parts['host'])) {
            return $url;
        }
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        return rtrim($origin, '/') . '/' . ltrim($url, '/');
    }

    public static function catalog_shortcode(array $atts): string {
        $atts = shortcode_atts(['limit' => self::settings()['catalog_limit'], 'type' => ''], $atts, 'lynk_catalog');
        $query = [
            'limit' => max(1, min(100, absint($atts['limit']))),
            'offset' => 0,
        ];
        if ($atts['type']) {
            $query['item_type'] = sanitize_key((string)$atts['type']);
        }
        $response = self::request('GET', '/integrations/public/catalog?' . http_build_query($query));
        if (is_wp_error($response)) {
            return '<div class="lynk-crm-error">' . esc_html($response->get_error_message()) . '</div>';
        }
        if ((int)wp_remote_retrieve_response_code($response) >= 400) {
            return '<div class="lynk-crm-error">Unable to load Lynk catalog.</div>';
        }
        $payload = json_decode(wp_remote_retrieve_body($response), true);
        $items = is_array($payload['results'] ?? null) ? $payload['results'] : [];
        ob_start();
        ?>
        <div class="lynk-catalog">
            <?php foreach ($items as $item): ?>
                <article class="lynk-catalog__item">
                    <?php if (!empty($item['media_url'])): ?>
                        <img class="lynk-catalog__image" src="<?php echo esc_url(self::media_url((string)$item['media_url'])); ?>" alt="" loading="lazy" />
                    <?php endif; ?>
                    <h3><?php echo esc_html($item['name'] ?? 'Untitled'); ?></h3>
                    <?php if (!empty($item['description'])): ?><p><?php echo esc_html($item['description']); ?></p><?php endif; ?>
                    <div class="lynk-catalog__price"><?php echo esc_html(($item['currency'] ?? 'USD') . ' ' . number_format((float)($item['public_unit_price'] ?? 0), 2)); ?></div>
                </article>
            <?php endforeach; ?>
        </div>
        <?php
        return (string)ob_get_clean();
    }

    public static function order_form_shortcode(array $atts): string {
        $atts = shortcode_atts(['slug' => '', 'item_type' => ''], $atts, 'lynk_order_form');
        $slug = sanitize_text_field((string)$atts['slug']);
        if (!$slug) {
            return '<div class="lynk-crm-error">Order form requires a catalog slug.</div>';
        }
        ob_start();
        ?>
        <form class="lynk-order-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="lynk_crm_submit_order" />
            <input type="hidden" name="slug" value="<?php echo esc_attr($slug); ?>" />
            <input type="hidden" name="item_type" value="<?php echo esc_attr(sanitize_key((string)$atts['item_type'])); ?>" />
            <?php wp_nonce_field(self::NONCE_ACTION); ?>
            <label>Name <input required name="customer_name" type="text" /></label>
            <label>Email <input required name="customer_email" type="email" /></label>
            <label>Quantity <input required name="quantity" type="number" min="1" step="1" value="1" /></label>
            <button type="submit">Submit Order</button>
        </form>
        <?php
        return (string)ob_get_clean();
    }

    public static function handle_order_submit(): void {
        if (!wp_verify_nonce((string)($_POST['_wpnonce'] ?? ''), self::NONCE_ACTION)) {
            wp_die('Invalid request.', 403);
        }
        $slug = sanitize_text_field((string)($_POST['slug'] ?? ''));
        $quantity = max(1, absint($_POST['quantity'] ?? 1));
        $reference = 'wp-form-' . time() . '-' . wp_generate_password(8, false, false);
        $payload = [
            'external_reference' => $reference,
            'source_platform' => 'wordpress',
            'customer_name' => sanitize_text_field((string)($_POST['customer_name'] ?? '')),
            'customer_email' => sanitize_email((string)($_POST['customer_email'] ?? '')),
            'line_items' => [[
                'slug' => $slug,
                'item_type' => sanitize_key((string)($_POST['item_type'] ?? '')) ?: null,
                'quantity' => $quantity,
            ]],
            'metadata' => [
                'site_url' => home_url('/'),
                'source' => 'lynk_order_form',
            ],
        ];
        $response = self::request('POST', '/integrations/public/orders', $payload);
        $redirect = wp_get_referer() ?: home_url('/');
        if (is_wp_error($response) || (int)wp_remote_retrieve_response_code($response) >= 400) {
            wp_safe_redirect(add_query_arg('lynk_order', 'failed', $redirect));
            exit;
        }
        wp_safe_redirect(add_query_arg('lynk_order', 'submitted', $redirect));
        exit;
    }
}

Lynk_CRM_Connector::init();
