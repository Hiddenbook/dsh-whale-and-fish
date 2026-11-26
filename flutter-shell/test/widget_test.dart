import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('网页资源已经打进 assets', () async {
    final html = await rootBundle.loadString('assets/web/index.html');
    final css = await rootBundle.loadString('assets/web/style.css');
    final js = await rootBundle.loadString('assets/web/app.js');

    expect(html.contains('page-chat'), isTrue);
    expect(css.contains('.bubble'), isTrue);
    expect(js.contains('renderSlot'), isTrue);
  });
}
