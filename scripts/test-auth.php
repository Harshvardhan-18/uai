<?php
$_SERVER['HTTPS'] = 'on';
require_once '/var/www/html/wp-load.php';

$consumer_key = $_SERVER['PHP_AUTH_USER'] ?? '';
$consumer_secret = $_SERVER['PHP_AUTH_PW'] ?? '';

echo "CK: $consumer_key\n";
echo "CS: $consumer_secret\n";

global $wpdb;
$hashed_key = hash_hmac('sha256', $consumer_key, 'wc-api');
echo "Calculated hash: $hashed_key\n";

$row = $wpdb->get_row($wpdb->prepare(
    "SELECT key_id, user_id, permissions, consumer_key, consumer_secret, nonces FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s",
    $hashed_key
));

echo "DB row: " . var_export($row, true) . "\n";
if ($row) {
    echo "Secret comparison (hash_equals): " . (hash_equals($row->consumer_secret, $consumer_secret) ? 'MATCH' : 'MISMATCH') . "\n";
}
