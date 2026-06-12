<?php
/**
 * Plugin Name: TalkToGo Live Chat
 * Plugin URI:  https://github.com/talktogo/talktogo
 * Description: Adds the TalkToGo live chat widget to your WordPress site. Chat with your visitors in realtime, see who is online and which page they are on.
 * Version:     1.0.1
 * Author:      TalkToGo
 * License:     GPL-2.0-or-later
 * Text Domain: talktogo
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Direct access not allowed.
}

define( 'TALKTOGO_VERSION', '1.0.1' );

/**
 * Default options.
 */
function talktogo_default_options() {
	return array(
		'site_id'        => '',
		'widget_url'     => '',
		'enabled'        => '1',
		'hide_for_admin' => '0',
	);
}

function talktogo_get_options() {
	$options = get_option( 'talktogo_options', array() );
	return wp_parse_args( $options, talktogo_default_options() );
}

/**
 * Print the widget script in the site <head>.
 */
function talktogo_print_widget() {
	$options = talktogo_get_options();

	if ( '1' !== $options['enabled'] ) {
		return;
	}
	if ( empty( $options['site_id'] ) || empty( $options['widget_url'] ) ) {
		return;
	}
	if ( '1' === $options['hide_for_admin'] && current_user_can( 'manage_options' ) ) {
		return;
	}

	// Expose the site id as a global first: optimizers (LiteSpeed, WP Rocket,
	// Autoptimize) may merge script tags and drop the data-site-id attribute;
	// the widget falls back to window.talkToGoSiteId.
	printf(
		'<script data-no-optimize="1" data-cfasync="false" data-pagespeed-no-defer>window.talkToGoSiteId=%s;</script>' . "\n",
		wp_json_encode( $options['site_id'] )
	);
	printf(
		'<script src="%s" data-site-id="%s" data-no-optimize="1" data-cfasync="false" async></script>' . "\n",
		esc_url( $options['widget_url'] ),
		esc_attr( $options['site_id'] )
	);
}
add_action( 'wp_head', 'talktogo_print_widget', 99 );

/**
 * Keep the widget out of JS optimization in common cache plugins.
 */
function talktogo_js_excludes( $list ) {
	if ( ! is_array( $list ) ) {
		$list = array();
	}
	$list[] = 'talkToGoSiteId';
	$options = talktogo_get_options();
	if ( ! empty( $options['widget_url'] ) ) {
		$list[] = $options['widget_url'];
	}
	return $list;
}
add_filter( 'litespeed_optimize_js_excludes', 'talktogo_js_excludes' ); // LiteSpeed combine/minify
add_filter( 'litespeed_optm_js_defer_exc', 'talktogo_js_excludes' );    // LiteSpeed defer/delay
add_filter( 'rocket_exclude_js', 'talktogo_js_excludes' );              // WP Rocket
add_filter( 'autoptimize_filter_js_exclude', 'talktogo_js_excludes' );  // Autoptimize

/**
 * Settings page.
 */
function talktogo_register_settings() {
	register_setting(
		'talktogo',
		'talktogo_options',
		array(
			'type'              => 'array',
			'sanitize_callback' => 'talktogo_sanitize_options',
			'default'           => talktogo_default_options(),
		)
	);
}
add_action( 'admin_init', 'talktogo_register_settings' );

function talktogo_sanitize_options( $input ) {
	$output = talktogo_default_options();

	if ( isset( $input['site_id'] ) ) {
		$output['site_id'] = sanitize_text_field( $input['site_id'] );
	}
	if ( isset( $input['widget_url'] ) ) {
		$url = esc_url_raw( trim( $input['widget_url'] ) );
		// Only accept https script URLs.
		if ( 0 === strpos( $url, 'https://' ) ) {
			$output['widget_url'] = $url;
		}
	}
	$output['enabled']        = ! empty( $input['enabled'] ) ? '1' : '0';
	$output['hide_for_admin'] = ! empty( $input['hide_for_admin'] ) ? '1' : '0';

	return $output;
}

function talktogo_add_settings_page() {
	add_options_page(
		__( 'TalkToGo Live Chat', 'talktogo' ),
		__( 'TalkToGo', 'talktogo' ),
		'manage_options',
		'talktogo',
		'talktogo_render_settings_page'
	);
}
add_action( 'admin_menu', 'talktogo_add_settings_page' );

function talktogo_settings_link( $links ) {
	$settings = '<a href="' . esc_url( admin_url( 'options-general.php?page=talktogo' ) ) . '">' . __( 'Settings', 'talktogo' ) . '</a>';
	array_unshift( $links, $settings );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'talktogo_settings_link' );

function talktogo_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$options = talktogo_get_options();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'TalkToGo Live Chat', 'talktogo' ); ?></h1>
		<p>
			<?php esc_html_e( 'Connect your site to TalkToGo. Find your Site ID and Widget URL in the TalkToGo dashboard under Settings → Install on WordPress.', 'talktogo' ); ?>
		</p>
		<form action="options.php" method="post">
			<?php settings_fields( 'talktogo' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">
						<label for="talktogo_site_id"><?php esc_html_e( 'Site ID', 'talktogo' ); ?></label>
					</th>
					<td>
						<input
							type="text"
							id="talktogo_site_id"
							name="talktogo_options[site_id]"
							value="<?php echo esc_attr( $options['site_id'] ); ?>"
							class="regular-text"
							placeholder="e.g. 4f1c2c9e-1234-4d2a-9c1b-abcdef123456"
						/>
						<p class="description"><?php esc_html_e( 'The unique ID of your website in TalkToGo.', 'talktogo' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row">
						<label for="talktogo_widget_url"><?php esc_html_e( 'Widget URL', 'talktogo' ); ?></label>
					</th>
					<td>
						<input
							type="url"
							id="talktogo_widget_url"
							name="talktogo_options[widget_url]"
							value="<?php echo esc_attr( $options['widget_url'] ); ?>"
							class="regular-text code"
							placeholder="https://your-app.netlify.app/widget.js"
						/>
						<p class="description"><?php esc_html_e( 'The widget.js URL of your TalkToGo deployment (must be https).', 'talktogo' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Show widget', 'talktogo' ); ?></th>
					<td>
						<label>
							<input
								type="checkbox"
								name="talktogo_options[enabled]"
								value="1"
								<?php checked( '1', $options['enabled'] ); ?>
							/>
							<?php esc_html_e( 'Enable the chat widget on this site', 'talktogo' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Administrators', 'talktogo' ); ?></th>
					<td>
						<label>
							<input
								type="checkbox"
								name="talktogo_options[hide_for_admin]"
								value="1"
								<?php checked( '1', $options['hide_for_admin'] ); ?>
							/>
							<?php esc_html_e( 'Hide the widget for logged-in administrators', 'talktogo' ); ?>
						</label>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
