import { Component } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default class AppErrorBoundary extends Component {
  state = { failed: false, generation: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return <View key={this.state.generation} style={{ flex: 1 }}>{this.props.children}</View>;
    return <View style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>The workspace could not display.</Text>
      <Text style={styles.body}>Your original files and saved exports are still on the device. Unsaved edits in this workspace may be lost.</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => this.setState(state => ({ failed: false, generation: state.generation + 1 }))}>
        <Text style={styles.label}>Reopen workspace</Text>
      </Pressable>
    </View>;
  }
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#0f1115', padding: 28, justifyContent: 'center', gap: 20 }, title: { color: '#fff', fontSize: 24, fontWeight: '700' }, body: { color: '#bdc8da', lineHeight: 23, fontSize: 15 }, button: { backgroundColor: '#4f8cff', padding: 16, borderRadius: 10, alignItems: 'center' }, label: { color: '#fff', fontWeight: '700' } });
